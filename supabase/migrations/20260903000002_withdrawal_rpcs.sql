-- ============================================================================
-- Supabase Migration: 20260903000002_withdrawal_rpcs.sql
-- Description: Stored procedures for request_withdrawal and process_failed_withdrawal
-- ============================================================================

-- 1. RPC: request_withdrawal
CREATE OR REPLACE FUNCTION public.request_withdrawal(
    p_user_id UUID,
    p_network TEXT,
    p_to_address TEXT,
    p_amount NUMERIC(36, 18),
    p_fee NUMERIC(36, 18),
    p_asset TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_wallet_id UUID;
    v_available NUMERIC(36, 18);
    v_locked_withdrawal NUMERIC(36, 18);
    v_total_deduct NUMERIC(36, 18);
    v_withdrawal_id UUID;
    v_asset_clean TEXT := UPPER(TRIM(p_asset));
    v_network_clean TEXT := UPPER(TRIM(p_network));
    v_is_banned BOOLEAN := FALSE;
    v_is_on_hold BOOLEAN := FALSE;
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'User ID is required';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Withdrawal amount must be greater than zero';
    END IF;

    -- Check user profile restrictions
    SELECT COALESCE(is_banned, FALSE), COALESCE(is_on_hold, FALSE)
    INTO v_is_banned, v_is_on_hold
    FROM public.profiles
    WHERE id = p_user_id;

    IF v_is_banned OR v_is_on_hold THEN
        RAISE EXCEPTION 'Account is restricted from executing withdrawals.';
    END IF;

    v_total_deduct := p_amount + COALESCE(p_fee, 0);

    -- Find or provision wallet
    SELECT id INTO v_wallet_id
    FROM public.wallets
    WHERE user_id = p_user_id AND status = 'active'
    LIMIT 1;

    IF v_wallet_id IS NULL THEN
        SELECT id INTO v_wallet_id
        FROM public.wallets
        WHERE user_id = p_user_id
        LIMIT 1;
    END IF;

    IF v_wallet_id IS NULL THEN
        INSERT INTO public.wallets (user_id, status, provisioning_status)
        VALUES (p_user_id, 'active', 'completed')
        RETURNING id INTO v_wallet_id;
    END IF;

    -- Lock wallet_assets row
    SELECT available, locked_withdrawal
    INTO v_available, v_locked_withdrawal
    FROM public.wallet_assets
    WHERE wallet_id = v_wallet_id AND asset_code = v_asset_clean
    FOR UPDATE;

    IF v_available IS NULL OR v_available < v_total_deduct THEN
        RAISE EXCEPTION 'Insufficient balance. Available: %, Required: % (Amount % + Fee %)',
            COALESCE(v_available, 0), v_total_deduct, p_amount, COALESCE(p_fee, 0);
    END IF;

    -- Atomically deduct available balance and lock in locked_withdrawal
    UPDATE public.wallet_assets
    SET available = available - v_total_deduct,
        locked_withdrawal = locked_withdrawal + v_total_deduct,
        updated_at = NOW()
    WHERE wallet_id = v_wallet_id AND asset_code = v_asset_clean;

    -- Insert into onchain_withdrawals
    INSERT INTO public.onchain_withdrawals (
        user_id,
        wallet_id,
        to_address,
        amount,
        asset_symbol,
        network,
        status,
        metadata
    )
    VALUES (
        p_user_id,
        v_wallet_id,
        p_to_address,
        p_amount,
        v_asset_clean,
        v_network_clean,
        'PENDING',
        jsonb_build_object('fee', COALESCE(p_fee, 0), 'total_deducted', v_total_deduct)
    )
    RETURNING id INTO v_withdrawal_id;

    -- Also insert into withdrawals table if it exists for platform-wide records
    BEGIN
        INSERT INTO public.withdrawals (
            id,
            user_id,
            wallet_id,
            asset_code,
            network_code,
            destination_address,
            amount,
            network_fee,
            status,
            idempotency_key
        )
        VALUES (
            v_withdrawal_id,
            p_user_id,
            v_wallet_id,
            v_asset_clean,
            v_network_clean,
            p_to_address,
            p_amount,
            COALESCE(p_fee, 0),
            'pending',
            'w_' || v_withdrawal_id::TEXT
        )
        ON CONFLICT DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
        -- Continue if withdrawals table has unique constraints or triggers
        NULL;
    END;

    -- Record immutable ledger entry
    BEGIN
        INSERT INTO public.ledger_entries (
            wallet_id,
            user_id,
            asset_code,
            delta_available,
            delta_locked,
            available_after,
            locked_after,
            entry_type,
            ref_table,
            ref_id,
            idempotency_key
        )
        VALUES (
            v_wallet_id,
            p_user_id,
            v_asset_clean,
            -v_total_deduct,
            +v_total_deduct,
            v_available - v_total_deduct,
            v_locked_withdrawal + v_total_deduct,
            'withdrawal_lock',
            'onchain_withdrawals',
            v_withdrawal_id::TEXT,
            'wlock_' || v_withdrawal_id::TEXT
        );
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    RETURN v_withdrawal_id;
END;
$$;


-- 2. RPC: process_failed_withdrawal (Automatic Refund on Worker Failure)
CREATE OR REPLACE FUNCTION public.process_failed_withdrawal(
    p_withdrawal_id UUID,
    p_error_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_withdrawal RECORD;
    v_fee NUMERIC(36, 18) := 0;
    v_total_refund NUMERIC(36, 18);
    v_available_after NUMERIC(36, 18);
    v_locked_after NUMERIC(36, 18);
BEGIN
    IF p_withdrawal_id IS NULL THEN
        RAISE EXCEPTION 'Withdrawal ID is required';
    END IF;

    -- Lookup onchain_withdrawals record
    SELECT id, user_id, wallet_id, amount, asset_symbol, status, metadata
    INTO v_withdrawal
    FROM public.onchain_withdrawals
    WHERE id = p_withdrawal_id
    FOR UPDATE;

    IF v_withdrawal.id IS NULL THEN
        RAISE EXCEPTION 'Withdrawal % not found', p_withdrawal_id;
    END IF;

    -- Idempotency check: If already failed or completed, do not refund again
    IF v_withdrawal.status = 'FAILED' THEN
        RETURN jsonb_build_object('success', true, 'message', 'Already marked as failed');
    END IF;

    IF v_withdrawal.status IN ('CONFIRMED', 'COMPLETED') THEN
        RAISE EXCEPTION 'Cannot refund completed withdrawal %', p_withdrawal_id;
    END IF;

    -- Extract fee if recorded in metadata
    IF v_withdrawal.metadata IS NOT NULL AND v_withdrawal.metadata ? 'total_deducted' THEN
        v_total_refund := (v_withdrawal.metadata->>'total_deducted')::NUMERIC;
    ELSE
        IF v_withdrawal.metadata IS NOT NULL AND v_withdrawal.metadata ? 'fee' THEN
            v_fee := (v_withdrawal.metadata->>'fee')::NUMERIC;
        END IF;
        v_total_refund := v_withdrawal.amount + COALESCE(v_fee, 0);
    END IF;

    -- Credit available balance and release locked_withdrawal in wallet_assets
    UPDATE public.wallet_assets
    SET available = available + v_total_refund,
        locked_withdrawal = GREATEST(0, locked_withdrawal - v_total_refund),
        updated_at = NOW()
    WHERE wallet_id = v_withdrawal.wallet_id AND asset_code = v_withdrawal.asset_symbol
    RETURNING available, locked_withdrawal INTO v_available_after, v_locked_after;

    -- Mark onchain_withdrawals as FAILED
    UPDATE public.onchain_withdrawals
    SET status = 'FAILED',
        error_message = COALESCE(p_error_reason, 'Worker broadcast failure'),
        updated_at = NOW()
    WHERE id = p_withdrawal_id;

    -- Update withdrawals table if present
    BEGIN
        UPDATE public.withdrawals
        SET status = 'failed',
            updated_at = NOW()
        WHERE id = p_withdrawal_id OR idempotency_key = 'w_' || p_withdrawal_id::TEXT;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- Record refund ledger entry
    BEGIN
        INSERT INTO public.ledger_entries (
            wallet_id,
            user_id,
            asset_code,
            delta_available,
            delta_locked,
            available_after,
            locked_after,
            entry_type,
            ref_table,
            ref_id,
            idempotency_key
        )
        VALUES (
            v_withdrawal.wallet_id,
            v_withdrawal.user_id,
            v_withdrawal.asset_symbol,
            +v_total_refund,
            -v_total_refund,
            COALESCE(v_available_after, 0),
            COALESCE(v_locked_after, 0),
            'withdrawal_refund',
            'onchain_withdrawals',
            p_withdrawal_id::TEXT,
            'wrefund_' || p_withdrawal_id::TEXT
        );
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    RETURN jsonb_build_object(
        'success', true,
        'withdrawal_id', p_withdrawal_id,
        'refunded_amount', v_total_refund,
        'status', 'FAILED'
    );
END;
$$;
