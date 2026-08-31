-- ============================================================================
-- Supabase Migration: 20260831000002_deposit_listener.sql
-- Description: Processed deposits table and credit_user_deposit atomic RPC procedure
-- ============================================================================

-- 1. Create processed_deposits table to track on-chain processed deposit transaction hashes
CREATE TABLE IF NOT EXISTS public.processed_deposits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tx_hash TEXT UNIQUE NOT NULL,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    amount NUMERIC(36, 18) NOT NULL CHECK (amount > 0),
    chain TEXT NOT NULL DEFAULT 'EVM',
    asset TEXT NOT NULL DEFAULT 'USDT',
    status TEXT NOT NULL DEFAULT 'COMPLETED' CHECK (status IN ('PENDING', 'COMPLETED', 'FAILED')),
    block_number BIGINT,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for high-performance lookup by tx_hash and user_id
CREATE INDEX IF NOT EXISTS idx_processed_deposits_tx_hash ON public.processed_deposits(tx_hash);
CREATE INDEX IF NOT EXISTS idx_processed_deposits_user_id ON public.processed_deposits(user_id);

-- Enable RLS
ALTER TABLE public.processed_deposits ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own processed deposits
CREATE POLICY "Users can view own processed deposits"
    ON public.processed_deposits
    FOR SELECT
    USING (
        auth.role() = 'authenticated' AND (
            user_id = auth.uid()
            OR EXISTS (
                SELECT 1 FROM auth.users u
                WHERE u.id = auth.uid()
                AND (u.raw_user_meta_data->>'role' = 'admin' OR u.raw_app_meta_data->>'role' = 'admin')
            )
        )
    );

-- 2. Create or replace credit_user_deposit stored procedure (RPC)
CREATE OR REPLACE FUNCTION public.credit_user_deposit(
    p_user_id UUID,
    p_amount NUMERIC,
    p_tx_hash TEXT,
    p_asset TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_wallet_id UUID;
    v_asset_code TEXT := UPPER(TRIM(p_asset));
    v_available NUMERIC(36, 18);
    v_locked_escrow NUMERIC(36, 18);
    v_locked_withdrawal NUMERIC(36, 18);
    v_new_available NUMERIC(36, 18);
    v_idempotency_key TEXT := 'dep_rpc_' || p_tx_hash || '_' || v_asset_code;
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Deposit amount must be greater than zero.';
    END IF;

    -- 1. Ensure user wallet exists
    SELECT id INTO v_wallet_id
    FROM public.wallets
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF v_wallet_id IS NULL THEN
        INSERT INTO public.wallets (user_id, status, provisioning_status)
        VALUES (p_user_id, 'active', 'completed')
        RETURNING id INTO v_wallet_id;
    END IF;

    -- 2. Ensure asset exists in assets table
    INSERT INTO public.assets (code, name, decimals, is_enabled)
    VALUES (v_asset_code, v_asset_code, 18, true)
    ON CONFLICT (code) DO NOTHING;

    -- 3. Lock & Fetch or Initialize wallet_assets
    SELECT available, locked_escrow, locked_withdrawal
    INTO v_available, v_locked_escrow, v_locked_withdrawal
    FROM public.wallet_assets
    WHERE wallet_id = v_wallet_id AND asset_code = v_asset_code
    FOR UPDATE;

    IF NOT FOUND THEN
        v_available := 0.0;
        v_locked_escrow := 0.0;
        v_locked_withdrawal := 0.0;

        INSERT INTO public.wallet_assets (
            wallet_id,
            asset_code,
            available,
            locked_escrow,
            locked_withdrawal
        )
        VALUES (
            v_wallet_id,
            v_asset_code,
            p_amount,
            0.0,
            0.0
        );
        v_new_available := p_amount;
    ELSE
        v_new_available := v_available + p_amount;
        UPDATE public.wallet_assets
        SET available = v_new_available,
            updated_at = NOW()
        WHERE wallet_id = v_wallet_id AND asset_code = v_asset_code;
    END IF;

    -- 4. Record Immutable Ledger Entry
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
        v_asset_code,
        p_amount,
        0.0,
        v_new_available,
        v_locked_escrow + v_locked_withdrawal,
        'deposit_credit',
        'processed_deposits',
        p_tx_hash,
        'ledger_' || v_idempotency_key
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    -- 5. Record in deposits table for full auditing
    INSERT INTO public.deposits (
        user_id,
        wallet_id,
        asset_code,
        network_code,
        amount,
        txid,
        confirmations,
        status,
        credited_at,
        idempotency_key
    )
    VALUES (
        p_user_id,
        v_wallet_id,
        v_asset_code,
        'EVM',
        p_amount,
        p_tx_hash,
        12,
        'credited',
        NOW(),
        v_idempotency_key
    )
    ON CONFLICT (idempotency_key) DO UPDATE
    SET status = 'credited',
        credited_at = NOW(),
        updated_at = NOW();

    RETURN jsonb_build_object(
        'success', true,
        'user_id', p_user_id,
        'wallet_id', v_wallet_id,
        'asset', v_asset_code,
        'credited_amount', p_amount,
        'new_balance', v_new_available,
        'tx_hash', p_tx_hash
    );
END;
$$;
