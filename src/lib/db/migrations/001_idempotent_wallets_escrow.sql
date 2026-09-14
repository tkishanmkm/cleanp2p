/**
 * Idempotent PostgreSQL Migration for Paxones P2P Escrow & Wallets
 * 
 * Fixes:
 * 1. PostgreSQL error 42701 ("column total_balance of relation wallets already exists") using idempotent IF NOT EXISTS checks.
 * 2. Ensures total_balance, locked_balance, and computed available_balance columns exist.
 * 3. Provides atomic lock_seller_escrow(p_user_id, p_crypto_amount, p_escrow_fee) function.
 */

-- ==============================================================================
-- 1. Create or ensure wallets table exists with idempotent column structure
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    currency TEXT NOT NULL DEFAULT 'USDT',
    total_balance NUMERIC(28, 8) NOT NULL DEFAULT 0.00000000,
    locked_balance NUMERIC(28, 8) NOT NULL DEFAULT 0.00000000,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT wallets_user_currency_key UNIQUE (user_id, currency)
);

-- Ensure total_balance column exists idempotently
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'wallets' 
          AND column_name = 'total_balance'
    ) THEN
        ALTER TABLE public.wallets ADD COLUMN total_balance NUMERIC(28, 8) NOT NULL DEFAULT 0.00000000;
    END IF;
END $$;

-- Ensure locked_balance column exists idempotently
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'wallets' 
          AND column_name = 'locked_balance'
    ) THEN
        ALTER TABLE public.wallets ADD COLUMN locked_balance NUMERIC(28, 8) NOT NULL DEFAULT 0.00000000;
    END IF;
END $$;

-- Ensure available_balance generated column exists or is updated
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'wallets' 
          AND column_name = 'available_balance'
    ) THEN
        ALTER TABLE public.wallets 
        ADD COLUMN available_balance NUMERIC(28, 8) 
        GENERATED ALWAYS AS (total_balance - locked_balance) STORED;
    END IF;
END $$;

-- ==============================================================================
-- 2. Create lock_seller_escrow PL/pgSQL Function
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.lock_seller_escrow(
    p_user_id UUID,
    p_crypto_amount NUMERIC,
    p_escrow_fee NUMERIC,
    p_currency TEXT DEFAULT 'USDT'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_total_needed NUMERIC := p_crypto_amount + p_escrow_fee;
    v_current_available NUMERIC;
    v_wallet_id UUID;
BEGIN
    -- Check input validity
    IF v_total_needed <= 0 THEN
        RAISE EXCEPTION 'Invalid escrow lock amount: total needed must be greater than zero.';
    END IF;

    -- Lock the specific user's wallet row for update
    SELECT id, available_balance
    INTO v_wallet_id, v_current_available
    FROM public.wallets
    WHERE user_id = p_user_id AND currency = p_currency
    FOR UPDATE;

    IF v_wallet_id IS NULL THEN
        RAISE EXCEPTION 'Wallet not found for user % with currency %', p_user_id, p_currency;
    END IF;

    IF v_current_available < v_total_needed THEN
        RAISE EXCEPTION 'Insufficient available balance. Required: %, Available: %', v_total_needed, v_current_available;
    END IF;

    -- Atomically increase locked_balance
    UPDATE public.wallets
    SET locked_balance = locked_balance + v_total_needed,
        updated_at = NOW()
    WHERE id = v_wallet_id;

    RETURN jsonb_build_object(
        'success', true,
        'wallet_id', v_wallet_id,
        'locked_amount', v_total_needed,
        'remaining_available', v_current_available - v_total_needed
    );
END;
$$;
