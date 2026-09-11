-- ==============================================================================
-- Supabase Migration: 20260910000001_add_process_user_deposit_rpc.sql
-- Description: Creates the process_user_deposit RPC function for atomic
--              deposit processing by deposit worker jobs and webhooks.
-- ==============================================================================

CREATE OR REPLACE FUNCTION public.process_user_deposit(
    p_user_id UUID,
    p_address TEXT,
    p_asset TEXT,
    p_chain TEXT,
    p_amount NUMERIC,
    p_tx_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_wallet_id UUID;
    v_asset_id UUID;
    v_asset_clean TEXT := UPPER(TRIM(COALESCE(p_asset, 'ETH')));
    v_chain_clean TEXT := UPPER(TRIM(COALESCE(p_chain, 'SEPOLIA')));
    v_tx_hash_clean TEXT := TRIM(p_tx_hash);
    v_new_balance NUMERIC(36, 18);
    v_deposit_id UUID;
BEGIN
    -- 1. Idempotency Check: Prevent duplicate crediting
    IF EXISTS (
        SELECT 1 FROM public.processed_deposits 
        WHERE tx_hash = v_tx_hash_clean
    ) OR EXISTS (
        SELECT 1 FROM public.deposits 
        WHERE txid = v_tx_hash_clean
    ) OR EXISTS (
        SELECT 1 FROM public.onchain_deposits 
        WHERE tx_hash = v_tx_hash_clean AND status = 'CONFIRMED'
    ) THEN
        RETURN jsonb_build_object(
            'success', true,
            'code', 'ALREADY_PROCESSED',
            'message', 'Deposit transaction has already been credited'
        );
    END IF;

    -- 2. Resolve User Wallet
    SELECT id INTO v_wallet_id
    FROM public.wallets
    WHERE user_id::uuid = p_user_id::uuid
    LIMIT 1;

    IF v_wallet_id IS NULL THEN
        INSERT INTO public.wallets (user_id, currency, balance, locked_balance, is_active, created_at, updated_at)
        VALUES (p_user_id::uuid, 'USD', 0, 0, true, NOW(), NOW())
        RETURNING id INTO v_wallet_id;
    END IF;

    -- 3. Resolve Asset
    SELECT id INTO v_asset_id
    FROM public.assets
    WHERE UPPER(symbol) = v_asset_clean
    LIMIT 1;

    -- 4. Insert or Update wallet_assets
    IF v_asset_id IS NOT NULL THEN
        INSERT INTO public.wallet_assets (wallet_id, asset_id, user_id, balance, locked_balance, created_at, updated_at)
        VALUES (v_wallet_id, v_asset_id, p_user_id::uuid, p_amount, 0, NOW(), NOW())
        ON CONFLICT (wallet_id, asset_id)
        DO UPDATE SET
            balance = public.wallet_assets.balance + EXCLUDED.balance,
            updated_at = NOW()
        RETURNING balance INTO v_new_balance;
    ELSE
        -- Fallback balance update on primary wallet
        UPDATE public.wallets
        SET balance = balance + p_amount, updated_at = NOW()
        WHERE id = v_wallet_id
        RETURNING balance INTO v_new_balance;
    END IF;

    -- 5. Record in deposits table
    INSERT INTO public.deposits (
        user_id,
        wallet_id,
        asset,
        network,
        amount,
        txid,
        status,
        address,
        created_at,
        updated_at
    ) VALUES (
        p_user_id::uuid,
        v_wallet_id,
        v_asset_clean,
        v_chain_clean,
        p_amount,
        v_tx_hash_clean,
        'completed',
        p_address,
        NOW(),
        NOW()
    )
    RETURNING id INTO v_deposit_id;

    -- 6. Record in onchain_deposits table
    INSERT INTO public.onchain_deposits (
        user_id,
        wallet_id,
        network,
        asset_symbol,
        tx_hash,
        from_address,
        to_address,
        address,
        amount,
        status,
        confirmations,
        created_at,
        updated_at
    ) VALUES (
        p_user_id::uuid,
        v_wallet_id,
        v_chain_clean,
        v_asset_clean,
        v_tx_hash_clean,
        '0x0000000000000000000000000000000000000000',
        p_address,
        p_address,
        p_amount,
        'CONFIRMED',
        12,
        NOW(),
        NOW()
    )
    ON CONFLICT (tx_hash, log_index) DO NOTHING;

    -- 7. Record in processed_deposits for replay prevention
    INSERT INTO public.processed_deposits (
        tx_hash,
        log_index,
        network,
        user_id,
        amount,
        asset,
        created_at
    ) VALUES (
        v_tx_hash_clean,
        0,
        v_chain_clean,
        p_user_id::uuid,
        p_amount,
        v_asset_clean,
        NOW()
    )
    ON CONFLICT DO NOTHING;

    -- 8. Record Ledger Entry for Audit
    INSERT INTO public.ledger_entries (
        user_id,
        wallet_id,
        asset_id,
        amount,
        fee,
        balance_after,
        locked_after,
        entry_type,
        reference_type,
        reference_id,
        created_at
    ) VALUES (
        p_user_id::uuid,
        v_wallet_id,
        v_asset_id,
        p_amount,
        0,
        COALESCE(v_new_balance, p_amount),
        0,
        'deposit_credit',
        'deposits',
        v_deposit_id::TEXT,
        NOW()
    );

    RETURN jsonb_build_object(
        'success', true,
        'deposit_id', v_deposit_id,
        'new_balance', v_new_balance,
        'message', 'Deposit credited successfully'
    );
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION public.process_user_deposit(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT) TO authenticated, anon, service_role;

-- Function: claim_pending_withdrawals
CREATE OR REPLACE FUNCTION public.claim_pending_withdrawals(p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
    id UUID,
    user_id UUID,
    wallet_id UUID,
    asset_symbol TEXT,
    amount NUMERIC,
    destination_address TEXT,
    to_address TEXT,
    network TEXT,
    status TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
BEGIN
    RETURN QUERY
    WITH claimed AS (
        SELECT w.id
        FROM public.withdrawals w
        WHERE w.status IN ('QUEUED', 'approved', 'PENDING')
        ORDER BY w.created_at ASC
        LIMIT p_limit
        FOR UPDATE SKIP LOCKED
    )
    UPDATE public.withdrawals w
    SET status = 'processing',
        updated_at = NOW()
    FROM claimed
    WHERE w.id = claimed.id
    RETURNING 
        w.id,
        w.user_id,
        w.wallet_id,
        w.asset_symbol,
        w.amount,
        w.destination_address,
        w.destination_address AS to_address,
        w.network,
        w.status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_pending_withdrawals(INTEGER) TO authenticated, anon, service_role;

