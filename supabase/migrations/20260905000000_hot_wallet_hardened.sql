-- ============================================================================
-- Supabase Migration: 20260905000000_hot_wallet_hardened.sql
-- Description: Hardened Hot Wallet Infrastructure:
--              1. platform_settings table & Circuit Breakers
--              2. Composite log-index uniqueness on onchain deposits
--              3. ingest_and_credit_deposit() stored procedure
--              4. lock_funds_for_withdrawal() atomic locking procedure
--              5. withdrawals table alignment
-- ============================================================================

-- 1. Create platform_settings table for Circuit Breakers and Global Emergency Freeze
CREATE TABLE IF NOT EXISTS public.platform_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    withdrawals_enabled BOOLEAN NOT NULL DEFAULT true,
    global_kill_switch_active BOOLEAN NOT NULL DEFAULT false,
    max_single_withdrawal_usd NUMERIC(18, 2) NOT NULL DEFAULT 50000.00,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure default configuration exists
INSERT INTO public.platform_settings (id, withdrawals_enabled, global_kill_switch_active, max_single_withdrawal_usd)
VALUES (1, true, false, 50000.00)
ON CONFLICT (id) DO NOTHING;

-- 2. Ensure log_index exists on onchain_deposits and enforce (tx_hash, log_index) uniqueness
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'onchain_deposits' AND column_name = 'log_index'
    ) THEN
        ALTER TABLE public.onchain_deposits ADD COLUMN log_index INTEGER NOT NULL DEFAULT 0;
    END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_onchain_deposits_tx_log
ON public.onchain_deposits (tx_hash, log_index);

-- 3. Ensure withdrawals table exists with standard schema
CREATE TABLE IF NOT EXISTS public.withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    wallet_id UUID,
    asset_symbol TEXT NOT NULL,
    asset_code TEXT,
    amount NUMERIC(36, 18) NOT NULL CHECK (amount > 0),
    network_fee NUMERIC(36, 18) NOT NULL DEFAULT 0,
    destination_address TEXT NOT NULL,
    network TEXT NOT NULL,
    network_code TEXT,
    status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED', 'approved', 'processing', 'BROADCASTED', 'completed', 'failed', 'rejected')),
    tx_hash TEXT,
    txid TEXT,
    broadcast_attempts INTEGER NOT NULL DEFAULT 0,
    broadcast_error TEXT,
    broadcasted_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_withdrawals_user_id ON public.withdrawals(user_id);
CREATE INDEX IF NOT EXISTS idx_withdrawals_status ON public.withdrawals(status);

-- 4. Ingest and Credit Deposit Stored Procedure (Atomic, Idempotent)
CREATE OR REPLACE FUNCTION public.ingest_and_credit_deposit(
    p_tx_hash TEXT,
    p_log_index INTEGER,
    p_network TEXT,
    p_to_address TEXT,
    p_amount NUMERIC,
    p_asset_symbol TEXT,
    p_confirmations INTEGER DEFAULT 1
)
RETURNS TABLE (
    deposit_id UUID,
    already_processed BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_user_id UUID;
    v_wallet_id UUID;
    v_deposit_id UUID;
    v_existing_status TEXT;
    v_asset_code TEXT := UPPER(TRIM(p_asset_symbol));
    v_norm_network TEXT := UPPER(TRIM(p_network));
    v_clean_address TEXT := LOWER(TRIM(p_to_address));
    v_req_confirmations INTEGER;
BEGIN
    -- Determine required confirmations by network
    CASE v_norm_network
        WHEN 'TRC20', 'TRON', 'TRX' THEN v_req_confirmations := 19;
        WHEN 'BEP20', 'BSC', 'BINANCE' THEN v_req_confirmations := 15;
        WHEN 'POLYGON', 'MATIC' THEN v_req_confirmations := 128;
        WHEN 'BITCOIN', 'BTC' THEN v_req_confirmations := 2;
        ELSE v_req_confirmations := 12;
    END CASE;

    -- 1. Check if deposit already exists by (tx_hash, log_index)
    SELECT id, status INTO v_deposit_id, v_existing_status
    FROM public.onchain_deposits
    WHERE tx_hash = p_tx_hash AND log_index = p_log_index
    LIMIT 1;

    IF v_deposit_id IS NOT NULL AND v_existing_status = 'CREDITED' THEN
        RETURN QUERY SELECT v_deposit_id, true;
        RETURN;
    END IF;

    -- 2. Resolve destination address to a registered user
    SELECT user_id, wallet_id INTO v_user_id, v_wallet_id
    FROM public.deposit_addresses
    WHERE LOWER(address) = v_clean_address
    LIMIT 1;

    IF v_user_id IS NULL THEN
        SELECT user_id INTO v_user_id
        FROM public.user_deposit_addresses
        WHERE LOWER(address) = v_clean_address
        LIMIT 1;
    END IF;

    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Destination address % does not match any registered platform user', p_to_address;
    END IF;

    -- Resolve or initialize wallet container
    IF v_wallet_id IS NULL THEN
        SELECT id INTO v_wallet_id
        FROM public.wallets
        WHERE user_id = v_user_id
        LIMIT 1;

        IF v_wallet_id IS NULL THEN
            INSERT INTO public.wallets (user_id, status, provisioning_status)
            VALUES (v_user_id, 'active', 'completed')
            RETURNING id INTO v_wallet_id;
        END IF;
    END IF;

    -- 3. Upsert onchain_deposits record
    IF v_deposit_id IS NULL THEN
        INSERT INTO public.onchain_deposits (
            user_id,
            tx_hash,
            log_index,
            network,
            to_address,
            amount,
            asset_symbol,
            confirmations,
            required_confirmations,
            status,
            created_at,
            updated_at
        ) VALUES (
            v_user_id,
            p_tx_hash,
            p_log_index,
            v_norm_network,
            p_to_address,
            p_amount,
            v_asset_code,
            p_confirmations,
            v_req_confirmations,
            CASE WHEN p_confirmations >= v_req_confirmations THEN 'CREDITED' ELSE 'PENDING' END,
            NOW(),
            NOW()
        )
        RETURNING id INTO v_deposit_id;
    ELSE
        UPDATE public.onchain_deposits
        SET confirmations = p_confirmations,
            status = CASE WHEN p_confirmations >= v_req_confirmations THEN 'CREDITED' ELSE status END,
            updated_at = NOW()
        WHERE id = v_deposit_id;
    END IF;

    -- 4. Credit balance if confirmation threshold is reached and not previously credited
    IF p_confirmations >= v_req_confirmations AND (v_existing_status IS NULL OR v_existing_status <> 'CREDITED') THEN
        -- Upsert wallet_assets with row locking
        INSERT INTO public.wallet_assets (wallet_id, asset_code, available, locked_escrow, locked_withdrawal, updated_at)
        VALUES (v_wallet_id, v_asset_code, p_amount, 0, 0, NOW())
        ON CONFLICT (wallet_id, asset_code)
        DO UPDATE SET
            available = public.wallet_assets.available + EXCLUDED.available,
            updated_at = NOW();

        -- Mark credited_at on deposit record
        UPDATE public.onchain_deposits
        SET credited_at = NOW(),
            status = 'CREDITED'
        WHERE id = v_deposit_id;

        -- Immutable ledger log
        INSERT INTO public.ledger_entries (
            wallet_id,
            user_id,
            asset_code,
            delta_available,
            delta_locked,
            entry_type,
            ref_table,
            ref_id,
            idempotency_key
        ) VALUES (
            v_wallet_id,
            v_user_id,
            v_asset_code,
            p_amount,
            0,
            'deposit_credit',
            'onchain_deposits',
            v_deposit_id,
            'ingest_' || p_tx_hash || '_' || p_log_index
        )
        ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    RETURN QUERY SELECT v_deposit_id, false;
END;
$$;

-- 5. Lock Funds for Withdrawal Stored Procedure (Row-Level Locking)
CREATE OR REPLACE FUNCTION public.lock_funds_for_withdrawal(
    p_user_id UUID,
    p_asset_symbol TEXT,
    p_amount NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_wallet_id UUID;
    v_asset_code TEXT := UPPER(TRIM(p_asset_symbol));
    v_available NUMERIC;
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Withdrawal amount must be strictly greater than 0';
    END IF;

    -- 1. Find user's wallet
    SELECT id INTO v_wallet_id
    FROM public.wallets
    WHERE user_id = p_user_id
    LIMIT 1;

    IF v_wallet_id IS NULL THEN
        RETURN false;
    END IF;

    -- 2. Lock row FOR UPDATE to prevent race conditions
    SELECT available INTO v_available
    FROM public.wallet_assets
    WHERE wallet_id = v_wallet_id AND asset_code = v_asset_code
    FOR UPDATE;

    IF v_available IS NULL OR v_available < p_amount THEN
        RETURN false;
    END IF;

    -- 3. Atomically transfer funds from available to locked_withdrawal
    UPDATE public.wallet_assets
    SET available = available - p_amount,
        locked_withdrawal = locked_withdrawal + p_amount,
        updated_at = NOW()
    WHERE wallet_id = v_wallet_id AND asset_code = v_asset_code;

    RETURN true;
END;
$$;
