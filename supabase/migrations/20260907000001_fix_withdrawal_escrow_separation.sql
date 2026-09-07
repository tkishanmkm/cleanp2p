-- ============================================================================
-- Supabase Migration: 20260907000001_fix_withdrawal_escrow_separation.sql
-- Description: Strict architectural separation between on-chain withdrawals and P2P escrow.
--              Withdrawals deduct directly from available balance and insert PENDING 
--              records in wallet_transactions without touching locked_escrow.
-- ============================================================================

-- 1. Ensure wallet_transactions has required columns
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'wallet_transactions' AND column_name = 'tx_type'
    ) THEN
        ALTER TABLE public.wallet_transactions ADD COLUMN tx_type TEXT;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'wallet_transactions' AND column_name = 'fee'
    ) THEN
        ALTER TABLE public.wallet_transactions ADD COLUMN fee NUMERIC(36, 18) DEFAULT 0.0;
    END IF;
END $$;

-- 2. Stored Procedure: request_withdrawal (Core Signature)
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
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_wallet_id UUID;
    v_available NUMERIC(36, 18);
    v_locked_escrow NUMERIC(36, 18);
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

    -- Lock wallet_assets row for update
    SELECT available, locked_escrow, locked_withdrawal
    INTO v_available, v_locked_escrow, v_locked_withdrawal
    FROM public.wallet_assets
    WHERE wallet_id = v_wallet_id AND (asset_code = v_asset_clean OR asset_code = p_asset)
    FOR UPDATE;

    IF v_available IS NULL OR v_available < v_total_deduct THEN
        RAISE EXCEPTION 'Insufficient balance. Available: %, Required: % (Amount % + Fee %)',
            COALESCE(v_available, 0), v_total_deduct, p_amount, COALESCE(p_fee, 0);
    END IF;

    -- Generate Withdrawal UUID
    v_withdrawal_id := gen_random_uuid();

    -- Deduct directly from available balance (Do NOT modify locked_escrow)
    UPDATE public.wallet_assets
    SET available = available - v_total_deduct,
        locked_withdrawal = locked_withdrawal + v_total_deduct,
        updated_at = NOW()
    WHERE wallet_id = v_wallet_id AND (asset_code = v_asset_clean OR asset_code = p_asset);

    -- Keep users balance_usdt in sync if applicable
    IF v_asset_clean = 'USDT' THEN
        BEGIN
            UPDATE public.users
            SET balance_usdt = GREATEST(0, COALESCE(balance_usdt, 0) - v_total_deduct)
            WHERE id = p_user_id;
        EXCEPTION WHEN OTHERS THEN
            NULL;
        END;
    END IF;

    -- 1. Insert into public.wallet_transactions with tx_type = 'WITHDRAWAL' and status = 'PENDING'
    BEGIN
        INSERT INTO public.wallet_transactions (
            id,
            user_id,
            type,
            tx_type,
            network,
            asset_symbol,
            amount,
            fee,
            from_address,
            to_address,
            status,
            created_at
        ) VALUES (
            v_withdrawal_id,
            p_user_id,
            'WITHDRAWAL',
            'WITHDRAWAL',
            v_network_clean,
            v_asset_clean,
            p_amount,
            COALESCE(p_fee, 0),
            'Platform Hot Wallet',
            p_to_address,
            'PENDING',
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- 2. Insert into public.withdrawals table
    BEGIN
        INSERT INTO public.withdrawals (
            id,
            user_id,
            wallet_id,
            asset_code,
            asset,
            network_code,
            chain,
            destination_address,
            amount,
            network_fee,
            status,
            idempotency_key,
            created_at,
            updated_at
        ) VALUES (
            v_withdrawal_id,
            p_user_id,
            v_wallet_id,
            v_asset_clean,
            v_asset_clean,
            v_network_clean,
            v_network_clean,
            p_to_address,
            p_amount,
            COALESCE(p_fee, 0),
            'pending',
            'w_' || v_withdrawal_id::TEXT,
            NOW(),
            NOW()
        )
        ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- 3. Insert into public.onchain_withdrawals table
    BEGIN
        INSERT INTO public.onchain_withdrawals (
            id,
            user_id,
            wallet_id,
            to_address,
            amount,
            asset_symbol,
            network,
            status,
            metadata,
            created_at
        ) VALUES (
            v_withdrawal_id,
            p_user_id,
            v_wallet_id,
            p_to_address,
            p_amount,
            v_asset_clean,
            v_network_clean,
            'PENDING',
            jsonb_build_object('fee', COALESCE(p_fee, 0), 'total_deducted', v_total_deduct),
            NOW()
        )
        ON CONFLICT (id) DO NOTHING;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- 4. Record Immutable Ledger Entry
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
        ) VALUES (
            v_wallet_id,
            p_user_id,
            v_asset_clean,
            -v_total_deduct,
            +v_total_deduct,
            v_available - v_total_deduct,
            v_locked_withdrawal + v_total_deduct,
            'withdrawal_lock',
            'withdrawals',
            v_withdrawal_id::TEXT,
            'wlock_' || v_withdrawal_id::TEXT
        );
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    RETURN v_withdrawal_id;
END;
$$;


-- 3. Stored Procedure: Client-Side Caller Signature for request_withdrawal
CREATE OR REPLACE FUNCTION public.request_withdrawal(
    p_asset_code TEXT,
    p_network_code TEXT,
    p_destination_address TEXT,
    p_amount NUMERIC(36, 18),
    p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_fee NUMERIC(36, 18) := 0.0;
    v_withdrawal_id UUID;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- Fetch network fee from asset_networks if available
    SELECT COALESCE(network_fee, 0.0) INTO v_fee
    FROM public.asset_networks
    WHERE asset_code = UPPER(TRIM(p_asset_code)) 
      AND network_code = UPPER(TRIM(p_network_code))
      AND is_enabled = TRUE
    LIMIT 1;

    v_withdrawal_id := public.request_withdrawal(
        p_user_id := v_user_id,
        p_network := p_network_code,
        p_to_address := p_destination_address,
        p_amount := p_amount,
        p_fee := v_fee,
        p_asset := p_asset_code
    );

    RETURN jsonb_build_object(
        'success', true,
        'withdrawal_id', v_withdrawal_id,
        'amount', p_amount,
        'network_fee', v_fee,
        'status', 'pending'
    );
END;
$$;


-- 4. Stored Procedure: process_withdrawal (for API routes)
CREATE OR REPLACE FUNCTION public.process_withdrawal(
    p_user_id UUID,
    p_asset_symbol TEXT,
    p_amount NUMERIC(36, 18),
    p_destination_address TEXT,
    p_chain TEXT DEFAULT 'ETH'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_withdrawal_id UUID;
    v_fee NUMERIC(36, 18) := 0.0;
BEGIN
    v_withdrawal_id := public.request_withdrawal(
        p_user_id := p_user_id,
        p_network := COALESCE(p_chain, 'ETH'),
        p_to_address := p_destination_address,
        p_amount := p_amount,
        p_fee := v_fee,
        p_asset := p_asset_symbol
    );

    RETURN jsonb_build_object(
        'success', true,
        'withdrawal_id', v_withdrawal_id,
        'amount', p_amount,
        'status', 'pending'
    );
END;
$$;
