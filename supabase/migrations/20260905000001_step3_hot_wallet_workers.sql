-- ============================================================================
-- Supabase Migration: 20260905000001_step3_hot_wallet_workers.sql
-- Description: Step 3 Hot Wallet Infrastructure:
--              1. hot_wallet_nonces table & allocate_hot_wallet_nonce() RPC
--              2. complete_onchain_withdrawal() RPC
-- ============================================================================

-- 1. Create hot_wallet_nonces table to enforce atomic, sequential EVM nonces
CREATE TABLE IF NOT EXISTS public.hot_wallet_nonces (
    network_code TEXT PRIMARY KEY,
    current_nonce BIGINT NOT NULL DEFAULT 0,
    hot_wallet_address TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed default network records
INSERT INTO public.hot_wallet_nonces (network_code, current_nonce, hot_wallet_address)
VALUES 
    ('ERC20', 0, '0x0000000000000000000000000000000000000000'),
    ('SEPOLIA', 0, '0x0000000000000000000000000000000000000000'),
    ('BEP20', 0, '0x0000000000000000000000000000000000000000'),
    ('POLYGON', 0, '0x0000000000000000000000000000000000000000')
ON CONFLICT (network_code) DO NOTHING;

-- 2. Stored Procedure: allocate_hot_wallet_nonce
-- Atomically reserves a sequential nonce using row-level locking
CREATE OR REPLACE FUNCTION public.allocate_hot_wallet_nonce(
    p_network TEXT,
    p_wallet_address TEXT,
    p_onchain_pending_nonce BIGINT DEFAULT 0
)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_norm_network TEXT := UPPER(TRIM(p_network));
    v_current_nonce BIGINT;
    v_allocated_nonce BIGINT;
BEGIN
    -- Map network aliases
    IF v_norm_network IN ('ETH', 'ETHEREUM') THEN
        v_norm_network := 'ERC20';
    ELSIF v_norm_network IN ('BSC', 'BINANCE') THEN
        v_norm_network := 'BEP20';
    ELSIF v_norm_network IN ('MATIC') THEN
        v_norm_network := 'POLYGON';
    END IF;

    -- Lock the nonce record for this network
    SELECT current_nonce INTO v_current_nonce
    FROM public.hot_wallet_nonces
    WHERE network_code = v_norm_network
    FOR UPDATE;

    IF NOT FOUND THEN
        -- Initialize row for this network if not existing
        v_current_nonce := COALESCE(p_onchain_pending_nonce, 0);
        INSERT INTO public.hot_wallet_nonces (network_code, current_nonce, hot_wallet_address)
        VALUES (v_norm_network, v_current_nonce + 1, p_wallet_address);
        RETURN v_current_nonce;
    END IF;

    -- Reconcile with on-chain pending count if the on-chain pending count is higher
    IF p_onchain_pending_nonce IS NOT NULL AND p_onchain_pending_nonce > v_current_nonce THEN
        v_current_nonce := p_onchain_pending_nonce;
    END IF;

    v_allocated_nonce := v_current_nonce;

    -- Advance the nonce monotonically
    UPDATE public.hot_wallet_nonces
    SET current_nonce = v_allocated_nonce + 1,
        hot_wallet_address = COALESCE(NULLIF(p_wallet_address, ''), hot_wallet_address),
        updated_at = NOW()
    WHERE network_code = v_norm_network;

    RETURN v_allocated_nonce;
END;
$$;

-- 3. Stored Procedure: complete_onchain_withdrawal
-- Atomically clears locked_withdrawal, marks status as CONFIRMED, and writes ledger log
CREATE OR REPLACE FUNCTION public.complete_onchain_withdrawal(
    p_withdrawal_id UUID,
    p_tx_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_withdrawal RECORD;
    v_total_deducted NUMERIC(36, 18);
    v_fee NUMERIC(36, 18) := 0;
    v_available_after NUMERIC(36, 18);
    v_locked_after NUMERIC(36, 18);
BEGIN
    SELECT *
    INTO v_withdrawal
    FROM public.onchain_withdrawals
    WHERE id = p_withdrawal_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Withdrawal % not found', p_withdrawal_id;
    END IF;

    IF v_withdrawal.status IN ('CONFIRMED', 'COMPLETED') THEN
        RETURN jsonb_build_object('success', true, 'message', 'Already confirmed');
    END IF;

    -- Extract fee if recorded in metadata
    IF v_withdrawal.metadata IS NOT NULL AND v_withdrawal.metadata ? 'total_deducted' THEN
        v_total_deducted := (v_withdrawal.metadata->>'total_deducted')::NUMERIC;
    ELSE
        IF v_withdrawal.metadata IS NOT NULL AND v_withdrawal.metadata ? 'fee' THEN
            v_fee := (v_withdrawal.metadata->>'fee')::NUMERIC;
        END IF;
        v_total_deducted := v_withdrawal.amount + COALESCE(v_fee, 0);
    END IF;

    -- Release locked_withdrawal liability
    UPDATE public.wallet_assets
    SET locked_withdrawal = GREATEST(0, locked_withdrawal - v_total_deducted),
        updated_at = NOW()
    WHERE wallet_id = v_withdrawal.wallet_id AND asset_code = v_withdrawal.asset_symbol
    RETURNING available, locked_withdrawal INTO v_available_after, v_locked_after;

    -- Mark withdrawal as CONFIRMED
    UPDATE public.onchain_withdrawals
    SET status = 'CONFIRMED',
        tx_hash = COALESCE(p_tx_hash, tx_hash),
        updated_at = NOW()
    WHERE id = p_withdrawal_id;

    -- Update withdrawals table if present
    BEGIN
        UPDATE public.withdrawals
        SET status = 'completed',
            tx_hash = COALESCE(p_tx_hash, tx_hash),
            updated_at = NOW()
        WHERE id = p_withdrawal_id OR idempotency_key = 'w_' || p_withdrawal_id::TEXT;
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- Insert ledger completion entry
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
            0,
            -v_total_deducted,
            COALESCE(v_available_after, 0),
            COALESCE(v_locked_after, 0),
            'withdrawal_complete',
            'onchain_withdrawals',
            p_withdrawal_id::TEXT,
            'wcomp_' || p_withdrawal_id::TEXT
        );
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    RETURN jsonb_build_object(
        'success', true,
        'withdrawal_id', p_withdrawal_id,
        'status', 'CONFIRMED'
    );
END;
$$;
