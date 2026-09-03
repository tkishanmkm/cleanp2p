-- ============================================================================
-- Supabase Migration: 20260903000000_onchain_deposits_and_worker.sql
-- Description: On-chain deposits schema and process_confirmed_deposit RPC
-- ============================================================================

-- 1. Create onchain_deposits table
CREATE TABLE IF NOT EXISTS public.onchain_deposits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    tx_hash TEXT UNIQUE NOT NULL,
    network TEXT NOT NULL,
    to_address TEXT NOT NULL,
    from_address TEXT,
    amount NUMERIC(36, 18) NOT NULL CHECK (amount > 0),
    asset_symbol TEXT NOT NULL,
    confirmations INTEGER NOT NULL DEFAULT 0,
    required_confirmations INTEGER NOT NULL DEFAULT 12,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'CREDITED', 'FAILED')),
    block_number BIGINT,
    metadata JSONB DEFAULT '{}'::jsonb,
    credited_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indices for rapid lookup
CREATE INDEX IF NOT EXISTS idx_onchain_deposits_user_id ON public.onchain_deposits(user_id);
CREATE INDEX IF NOT EXISTS idx_onchain_deposits_tx_hash ON public.onchain_deposits(tx_hash);
CREATE INDEX IF NOT EXISTS idx_onchain_deposits_status ON public.onchain_deposits(status);
CREATE INDEX IF NOT EXISTS idx_onchain_deposits_network ON public.onchain_deposits(network);

-- Enable RLS
ALTER TABLE public.onchain_deposits ENABLE ROW LEVEL SECURITY;

-- Policies for onchain_deposits
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies WHERE tablename = 'onchain_deposits' AND policyname = 'Users can view their own onchain deposits'
    ) THEN
        CREATE POLICY "Users can view their own onchain deposits"
            ON public.onchain_deposits
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
    END IF;
END $$;

-- 2. Create or replace process_confirmed_deposit RPC (Overload 1: by deposit UUID)
CREATE OR REPLACE FUNCTION public.process_confirmed_deposit(
    p_deposit_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_deposit RECORD;
    v_wallet_id UUID;
    v_asset_code TEXT;
    v_amount NUMERIC(36, 18);
    v_user_id UUID;
    v_tx_hash TEXT;
    v_network TEXT;
    v_available NUMERIC(36, 18);
    v_locked_escrow NUMERIC(36, 18);
    v_locked_withdrawal NUMERIC(36, 18);
    v_new_available NUMERIC(36, 18);
    v_idempotency_key TEXT;
BEGIN
    SELECT * INTO v_deposit
    FROM public.onchain_deposits
    WHERE id = p_deposit_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Deposit record not found for ID %', p_deposit_id;
    END IF;

    IF v_deposit.status = 'CREDITED' THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Deposit already credited',
            'deposit_id', p_deposit_id,
            'status', 'CREDITED'
        );
    END IF;

    v_user_id := v_deposit.user_id;
    v_amount := v_deposit.amount;
    v_asset_code := UPPER(TRIM(v_deposit.asset_symbol));
    v_tx_hash := v_deposit.tx_hash;
    v_network := COALESCE(v_deposit.network, 'ERC20');
    v_idempotency_key := 'dep_proc_' || v_tx_hash || '_' || v_asset_code;

    -- 1. Ensure user wallet exists
    SELECT id INTO v_wallet_id
    FROM public.wallets
    WHERE user_id = v_user_id
    FOR UPDATE;

    IF v_wallet_id IS NULL THEN
        INSERT INTO public.wallets (user_id, status, provisioning_status)
        VALUES (v_user_id, 'active', 'completed')
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
        v_new_available := v_amount;

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
            v_amount,
            0.0,
            0.0
        );
    ELSE
        v_new_available := v_available + v_amount;
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
        v_user_id,
        v_asset_code,
        v_amount,
        0.0,
        v_new_available,
        COALESCE(v_locked_escrow, 0) + COALESCE(v_locked_withdrawal, 0),
        'deposit_credit',
        'onchain_deposits',
        v_tx_hash,
        'ledger_' || v_idempotency_key
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    -- 5. Mark onchain_deposits status as CREDITED
    UPDATE public.onchain_deposits
    SET status = 'CREDITED',
        credited_at = NOW(),
        updated_at = NOW()
    WHERE id = p_deposit_id;

    -- 6. Upsert into standard deposits table
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
        v_user_id,
        v_wallet_id,
        v_asset_code,
        v_network,
        v_amount,
        v_tx_hash,
        v_deposit.confirmations,
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
        'deposit_id', p_deposit_id,
        'user_id', v_user_id,
        'wallet_id', v_wallet_id,
        'asset', v_asset_code,
        'credited_amount', v_amount,
        'new_balance', v_new_available,
        'tx_hash', v_tx_hash
    );
END;
$$;

-- 3. Create or replace process_confirmed_deposit RPC (Overload 2: by direct parameters)
CREATE OR REPLACE FUNCTION public.process_confirmed_deposit(
    p_user_id UUID,
    p_amount NUMERIC,
    p_tx_hash TEXT,
    p_asset TEXT,
    p_network TEXT DEFAULT 'ERC20'
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
    v_idempotency_key TEXT := 'dep_proc_' || p_tx_hash || '_' || v_asset_code;
    v_existing_onchain_id UUID;
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Deposit amount must be greater than zero.';
    END IF;

    -- 1. Check if already credited in onchain_deposits
    SELECT id INTO v_existing_onchain_id
    FROM public.onchain_deposits
    WHERE tx_hash = p_tx_hash AND status = 'CREDITED';

    IF v_existing_onchain_id IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'message', 'Transaction already credited',
            'tx_hash', p_tx_hash
        );
    END IF;

    -- 2. Ensure user wallet exists
    SELECT id INTO v_wallet_id
    FROM public.wallets
    WHERE user_id = p_user_id
    FOR UPDATE;

    IF v_wallet_id IS NULL THEN
        INSERT INTO public.wallets (user_id, status, provisioning_status)
        VALUES (p_user_id, 'active', 'completed')
        RETURNING id INTO v_wallet_id;
    END IF;

    -- 3. Ensure asset exists in assets table
    INSERT INTO public.assets (code, name, decimals, is_enabled)
    VALUES (v_asset_code, v_asset_code, 18, true)
    ON CONFLICT (code) DO NOTHING;

    -- 4. Lock & update wallet_assets
    SELECT available, locked_escrow, locked_withdrawal
    INTO v_available, v_locked_escrow, v_locked_withdrawal
    FROM public.wallet_assets
    WHERE wallet_id = v_wallet_id AND asset_code = v_asset_code
    FOR UPDATE;

    IF NOT FOUND THEN
        v_available := 0.0;
        v_locked_escrow := 0.0;
        v_locked_withdrawal := 0.0;
        v_new_available := p_amount;

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
    ELSE
        v_new_available := v_available + p_amount;
        UPDATE public.wallet_assets
        SET available = v_new_available,
            updated_at = NOW()
        WHERE wallet_id = v_wallet_id AND asset_code = v_asset_code;
    END IF;

    -- 5. Record Immutable Ledger Entry
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
        COALESCE(v_locked_escrow, 0) + COALESCE(v_locked_withdrawal, 0),
        'deposit_credit',
        'onchain_deposits',
        p_tx_hash,
        'ledger_' || v_idempotency_key
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    -- 6. Update onchain_deposits if exists
    UPDATE public.onchain_deposits
    SET status = 'CREDITED',
        credited_at = NOW(),
        updated_at = NOW()
    WHERE tx_hash = p_tx_hash;

    -- 7. Upsert into deposits table
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
        COALESCE(p_network, 'ERC20'),
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
