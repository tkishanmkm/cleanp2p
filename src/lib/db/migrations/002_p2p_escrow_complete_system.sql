-- ==============================================================================
-- Migration: Complete P2P Crypto Escrow & Financial Settlement System (Paxful / Noones Architecture)
-- Engine: PostgreSQL / Supabase
-- ==============================================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 1. Table: user_balances / wallets
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.user_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    asset TEXT NOT NULL DEFAULT 'USDT', -- 'USDT', 'BTC', 'ETH', 'LTC', etc.
    available_balance NUMERIC(28, 8) NOT NULL DEFAULT 0.00000000 CHECK (available_balance >= 0),
    locked_balance NUMERIC(28, 8) NOT NULL DEFAULT 0.00000000 CHECK (locked_balance >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT user_balances_user_asset_unique UNIQUE (user_id, asset)
);

CREATE INDEX IF NOT EXISTS idx_user_balances_user_asset ON public.user_balances (user_id, asset);

-- Sync with wallets table if present
CREATE TABLE IF NOT EXISTS public.wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    currency TEXT NOT NULL DEFAULT 'USDT',
    total_balance NUMERIC(28, 8) NOT NULL DEFAULT 0.00000000 CHECK (total_balance >= 0),
    locked_balance NUMERIC(28, 8) NOT NULL DEFAULT 0.00000000 CHECK (locked_balance >= 0),
    available_balance NUMERIC(28, 8) GENERATED ALWAYS AS (total_balance - locked_balance) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT wallets_user_currency_unique UNIQUE (user_id, currency)
);

-- ==============================================================================
-- 2. Table: p2p_offers (Buy / Sell Ads)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.p2p_offers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    offer_type TEXT NOT NULL CHECK (offer_type IN ('BUY', 'SELL')),
    crypto_currency TEXT NOT NULL DEFAULT 'USDT', -- BTC, ETH, USDT, LTC
    fiat_currency TEXT NOT NULL DEFAULT 'USD',   -- USD, EUR, INR, KES, NGN, etc.
    pricing_type TEXT NOT NULL DEFAULT 'fixed' CHECK (pricing_type IN ('fixed', 'market_margin')),
    price_per_unit NUMERIC(28, 8) NOT NULL CHECK (price_per_unit > 0),
    margin_percentage NUMERIC(8, 4) DEFAULT 0.00,
    min_amount NUMERIC(28, 8) NOT NULL CHECK (min_amount > 0),
    max_amount NUMERIC(28, 8) NOT NULL CHECK (max_amount >= min_amount),
    total_crypto_available NUMERIC(28, 8) NOT NULL DEFAULT 0.00000000 CHECK (total_crypto_available >= 0),
    payment_method TEXT NOT NULL,
    payment_time_limit_minutes INT NOT NULL DEFAULT 30 CHECK (payment_time_limit_minutes BETWEEN 5 AND 180),
    terms TEXT,
    auto_reply TEXT,
    status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'PAUSED', 'CLOSED', 'ARCHIVED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_p2p_offers_lookup ON public.p2p_offers (crypto_currency, fiat_currency, offer_type, status);

-- ==============================================================================
-- 3. Table: p2p_trades (Active P2P Trades)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.p2p_trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id UUID REFERENCES public.p2p_offers(id) ON DELETE SET NULL,
    seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    buyer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    crypto_currency TEXT NOT NULL DEFAULT 'USDT',
    fiat_currency TEXT NOT NULL DEFAULT 'USD',
    crypto_amount NUMERIC(28, 8) NOT NULL CHECK (crypto_amount > 0),
    fiat_amount NUMERIC(28, 8) NOT NULL CHECK (fiat_amount > 0),
    exchange_rate NUMERIC(28, 8) NOT NULL CHECK (exchange_rate > 0),
    escrow_fee NUMERIC(28, 8) NOT NULL DEFAULT 0.00000000 CHECK (escrow_fee >= 0),
    payment_method TEXT NOT NULL,
    payment_time_limit_minutes INT NOT NULL DEFAULT 30,
    payment_window_expires_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'ESCROW_LOCKED' CHECK (
        status IN (
            'CREATED',
            'ESCROW_LOCKED',
            'PAID',
            'DISPUTED',
            'COMPLETED',
            'CANCELLED',
            'EXPIRED',
            'RESOLVED_BUYER',
            'RESOLVED_SELLER'
        )
    ),
    paid_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    cancel_reason TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_p2p_trades_users ON public.p2p_trades (seller_id, buyer_id, status);
CREATE INDEX IF NOT EXISTS idx_p2p_trades_timer ON public.p2p_trades (payment_window_expires_at, status);

-- ==============================================================================
-- 4. Table: escrow_locks (Cryptographic Audit Trail for Escrow Funds)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.escrow_locks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id UUID NOT NULL REFERENCES public.p2p_trades(id) ON DELETE CASCADE,
    seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    buyer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    asset TEXT NOT NULL DEFAULT 'USDT',
    locked_amount NUMERIC(28, 8) NOT NULL CHECK (locked_amount > 0),
    fee_amount NUMERIC(28, 8) NOT NULL DEFAULT 0.00000000,
    status TEXT NOT NULL DEFAULT 'HELD' CHECK (status IN ('HELD', 'RELEASED_TO_BUYER', 'RETURNED_TO_SELLER', 'SEIZED')),
    locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    released_at TIMESTAMPTZ,
    CONSTRAINT escrow_locks_trade_unique UNIQUE (trade_id)
);

CREATE INDEX IF NOT EXISTS idx_escrow_locks_trade ON public.escrow_locks (trade_id, status);

-- ==============================================================================
-- 5. Table: disputes (Mediation & Dispute Resolution)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.disputes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    trade_id UUID NOT NULL REFERENCES public.p2p_trades(id) ON DELETE CASCADE,
    initiator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    respondent_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    reason TEXT NOT NULL,
    description TEXT,
    proof_attachments JSONB DEFAULT '[]'::jsonb,
    admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    admin_decision TEXT CHECK (admin_decision IN ('RELEASE_BUYER', 'REFUND_SELLER', 'SPLIT', 'DISMISSED')),
    admin_notes TEXT,
    status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN', 'UNDER_REVIEW', 'RESOLVED', 'CLOSED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    CONSTRAINT disputes_trade_unique UNIQUE (trade_id)
);

CREATE INDEX IF NOT EXISTS idx_disputes_trade ON public.disputes (trade_id, status);

-- ==============================================================================
-- 6. Table: deposits & withdrawals
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.deposits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    asset TEXT NOT NULL,
    amount NUMERIC(28, 8) NOT NULL CHECK (amount > 0),
    tx_hash TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'COMPLETED',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    currency TEXT NOT NULL,
    amount NUMERIC(28, 8) NOT NULL CHECK (amount > 0),
    destination_address TEXT NOT NULL,
    tx_hash TEXT,
    status TEXT NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'dispatched', 'completed', 'failed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ==============================================================================
-- 7. STORED PROCEDURE: lock_p2p_escrow(p_trade_id)
-- Atomically deducts crypto from seller's available balance and locks in escrow
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.lock_p2p_escrow(p_trade_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_trade RECORD;
    v_seller_balance RECORD;
    v_total_escrow NUMERIC(28, 8);
BEGIN
    -- 1. Fetch trade details with exclusive row lock
    SELECT * INTO v_trade
    FROM public.p2p_trades
    WHERE id = p_trade_id
    FOR UPDATE;

    IF v_trade.id IS NULL THEN
        RAISE EXCEPTION 'Trade not found with ID: %', p_trade_id;
    END IF;

    IF v_trade.status NOT IN ('CREATED', 'ESCROW_LOCKED') THEN
        RAISE EXCEPTION 'Trade % is not in a lockable state (current status: %)', p_trade_id, v_trade.status;
    END IF;

    v_total_escrow := v_trade.crypto_amount + v_trade.escrow_fee;

    -- 2. Lock seller's user_balances row for update (prevent race conditions & double spending)
    SELECT * INTO v_seller_balance
    FROM public.user_balances
    WHERE user_id = v_trade.seller_id AND asset = v_trade.crypto_currency
    FOR UPDATE;

    IF v_seller_balance.id IS NULL THEN
        -- Check if row exists in wallets table or create user_balances row
        INSERT INTO public.user_balances (user_id, asset, available_balance, locked_balance)
        VALUES (v_trade.seller_id, v_trade.crypto_currency, 0.00000000, 0.00000000)
        ON CONFLICT (user_id, asset) DO NOTHING;

        SELECT * INTO v_seller_balance
        FROM public.user_balances
        WHERE user_id = v_trade.seller_id AND asset = v_trade.crypto_currency
        FOR UPDATE;
    END IF;

    -- Verify sufficient available balance
    IF v_seller_balance.available_balance < v_total_escrow THEN
        RAISE EXCEPTION 'Insufficient available balance. Required: %, Available: %', v_total_escrow, v_seller_balance.available_balance;
    END IF;

    -- 3. Atomic transfer from available_balance to locked_balance
    UPDATE public.user_balances
    SET 
        available_balance = available_balance - v_total_escrow,
        locked_balance = locked_balance + v_total_escrow,
        updated_at = NOW()
    WHERE id = v_seller_balance.id;

    -- Also sync with wallets table if present
    UPDATE public.wallets
    SET 
        locked_balance = locked_balance + v_total_escrow,
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id AND currency = v_trade.crypto_currency;

    -- 4. Record or update escrow_locks entry
    INSERT INTO public.escrow_locks (
        trade_id,
        seller_id,
        buyer_id,
        asset,
        locked_amount,
        fee_amount,
        status,
        locked_at
    )
    VALUES (
        v_trade.id,
        v_trade.seller_id,
        v_trade.buyer_id,
        v_trade.crypto_currency,
        v_trade.crypto_amount,
        v_trade.escrow_fee,
        'HELD',
        NOW()
    )
    ON CONFLICT (trade_id) DO UPDATE
    SET 
        locked_amount = EXCLUDED.locked_amount,
        fee_amount = EXCLUDED.fee_amount,
        status = 'HELD',
        locked_at = NOW();

    -- 5. Update trade status to ESCROW_LOCKED
    UPDATE public.p2p_trades
    SET 
        status = 'ESCROW_LOCKED',
        updated_at = NOW()
    WHERE id = p_trade_id;

    RETURN jsonb_build_object(
        'success', true,
        'trade_id', p_trade_id,
        'locked_amount', v_trade.crypto_amount,
        'fee_amount', v_trade.escrow_fee,
        'status', 'ESCROW_LOCKED'
    );
END;
$$;

-- ==============================================================================
-- 8. STORED PROCEDURE: release_p2p_escrow(p_trade_id)
-- Releases locked crypto from escrow to the buyer's available balance
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.release_p2p_escrow(p_trade_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_trade RECORD;
    v_escrow RECORD;
    v_total_deduct NUMERIC(28, 8);
BEGIN
    -- 1. Fetch and lock trade row
    SELECT * INTO v_trade
    FROM public.p2p_trades
    WHERE id = p_trade_id
    FOR UPDATE;

    IF v_trade.id IS NULL THEN
        RAISE EXCEPTION 'Trade not found with ID: %', p_trade_id;
    END IF;

    IF v_trade.status NOT IN ('ESCROW_LOCKED', 'PAID', 'DISPUTED') THEN
        RAISE EXCEPTION 'Trade % cannot be released from status: %', p_trade_id, v_trade.status;
    END IF;

    -- 2. Fetch and lock escrow record
    SELECT * INTO v_escrow
    FROM public.escrow_locks
    WHERE trade_id = p_trade_id
    FOR UPDATE;

    IF v_escrow.id IS NULL OR v_escrow.status != 'HELD' THEN
        RAISE EXCEPTION 'No active escrow lock found for trade %', p_trade_id;
    END IF;

    v_total_deduct := v_escrow.locked_amount + v_escrow.fee_amount;

    -- 3. Deduct locked balance and total balance from seller
    UPDATE public.user_balances
    SET 
        locked_balance = GREATEST(0, locked_balance - v_total_deduct),
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id AND asset = v_trade.crypto_currency;

    UPDATE public.wallets
    SET 
        total_balance = GREATEST(0, total_balance - v_total_deduct),
        locked_balance = GREATEST(0, locked_balance - v_total_deduct),
        updated_at = NOW()
    WHERE user_id = v_trade.seller_id AND currency = v_trade.crypto_currency;

    -- 4. Credit buyer available balance (ensure balance row exists)
    INSERT INTO public.user_balances (user_id, asset, available_balance, locked_balance)
    VALUES (v_trade.buyer_id, v_trade.crypto_currency, v_escrow.locked_amount, 0.00000000)
    ON CONFLICT (user_id, asset) DO UPDATE
    SET 
        available_balance = public.user_balances.available_balance + EXCLUDED.available_balance,
        updated_at = NOW();

    INSERT INTO public.wallets (user_id, currency, total_balance, locked_balance)
    VALUES (v_trade.buyer_id, v_trade.crypto_currency, v_escrow.locked_amount, 0.00000000)
    ON CONFLICT (user_id, currency) DO UPDATE
    SET 
        total_balance = public.wallets.total_balance + EXCLUDED.total_balance,
        updated_at = NOW();

    -- 5. Mark escrow lock as released
    UPDATE public.escrow_locks
    SET 
        status = 'RELEASED_TO_BUYER',
        released_at = NOW()
    WHERE id = v_escrow.id;

    -- 6. Mark trade completed
    UPDATE public.p2p_trades
    SET 
        status = 'COMPLETED',
        completed_at = NOW(),
        updated_at = NOW()
    WHERE id = p_trade_id;

    -- 7. If dispute existed, mark resolved
    UPDATE public.disputes
    SET 
        status = 'RESOLVED',
        admin_decision = 'RELEASE_BUYER',
        resolved_at = NOW()
    WHERE trade_id = p_trade_id;

    RETURN jsonb_build_object(
        'success', true,
        'trade_id', p_trade_id,
        'released_to_buyer', v_trade.buyer_id,
        'amount', v_escrow.locked_amount,
        'status', 'COMPLETED'
    );
END;
$$;

-- ==============================================================================
-- 9. STORED PROCEDURE: cancel_p2p_trade(p_trade_id)
-- Unlocks escrowed crypto and returns it to seller if timer expires or mutual cancel
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.cancel_p2p_trade(p_trade_id UUID, p_reason TEXT DEFAULT 'Payment window expired')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_trade RECORD;
    v_escrow RECORD;
    v_total_return NUMERIC(28, 8);
BEGIN
    -- 1. Fetch and lock trade row
    SELECT * INTO v_trade
    FROM public.p2p_trades
    WHERE id = p_trade_id
    FOR UPDATE;

    IF v_trade.id IS NULL THEN
        RAISE EXCEPTION 'Trade not found with ID: %', p_trade_id;
    END IF;

    IF v_trade.status IN ('COMPLETED', 'CANCELLED', 'EXPIRED') THEN
        RAISE EXCEPTION 'Trade % is already finalized (status: %)', p_trade_id, v_trade.status;
    END IF;

    -- 2. Fetch escrow row
    SELECT * INTO v_escrow
    FROM public.escrow_locks
    WHERE trade_id = p_trade_id
    FOR UPDATE;

    IF v_escrow.id IS NOT NULL AND v_escrow.status = 'HELD' THEN
        v_total_return := v_escrow.locked_amount + v_escrow.fee_amount;

        -- Return locked funds back to seller available balance
        UPDATE public.user_balances
        SET 
            available_balance = available_balance + v_total_return,
            locked_balance = GREATEST(0, locked_balance - v_total_return),
            updated_at = NOW()
        WHERE user_id = v_trade.seller_id AND asset = v_trade.crypto_currency;

        UPDATE public.wallets
        SET 
            locked_balance = GREATEST(0, locked_balance - v_total_return),
            updated_at = NOW()
        WHERE user_id = v_trade.seller_id AND currency = v_trade.crypto_currency;

        -- Mark escrow as returned
        UPDATE public.escrow_locks
        SET 
            status = 'RETURNED_TO_SELLER',
            released_at = NOW()
        WHERE id = v_escrow.id;
    END IF;

    -- 3. Mark trade cancelled
    UPDATE public.p2p_trades
    SET 
        status = 'CANCELLED',
        cancelled_at = NOW(),
        cancel_reason = p_reason,
        updated_at = NOW()
    WHERE id = p_trade_id;

    RETURN jsonb_build_object(
        'success', true,
        'trade_id', p_trade_id,
        'status', 'CANCELLED',
        'returned_to_seller', v_trade.seller_id,
        'reason', p_reason
    );
END;
$$;

-- ==============================================================================
-- 10. STORED PROCEDURE: process_user_deposit(p_user_id, p_amount, p_asset, p_tx_hash)
-- Credits on-chain deposit safely with idempotency
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.process_user_deposit(
    p_user_id UUID,
    p_amount NUMERIC,
    p_asset TEXT,
    p_tx_hash TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_deposit_id UUID;
    v_norm_asset TEXT;
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Deposit amount must be greater than zero.';
    END IF;

    -- Normalize asset code (e.g. USDT_ERC20 -> USDT)
    v_norm_asset := CASE 
        WHEN p_asset ILIKE 'USDT%' THEN 'USDT'
        WHEN p_asset ILIKE 'BTC%' THEN 'BTC'
        WHEN p_asset ILIKE 'ETH%' THEN 'ETH'
        WHEN p_asset ILIKE 'LTC%' THEN 'LTC'
        ELSE UPPER(p_asset)
    END;

    -- Idempotent check
    SELECT id INTO v_deposit_id FROM public.deposits WHERE tx_hash = p_tx_hash;
    IF v_deposit_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'message', 'Deposit already credited', 'deposit_id', v_deposit_id);
    END IF;

    -- 1. Insert deposit log
    INSERT INTO public.deposits (user_id, asset, amount, tx_hash, status)
    VALUES (p_user_id, p_asset, p_amount, p_tx_hash, 'COMPLETED')
    RETURNING id INTO v_deposit_id;

    -- 2. Credit user_balances table
    INSERT INTO public.user_balances (user_id, asset, available_balance, locked_balance)
    VALUES (p_user_id, v_norm_asset, p_amount, 0.00000000)
    ON CONFLICT (user_id, asset) DO UPDATE
    SET 
        available_balance = public.user_balances.available_balance + EXCLUDED.available_balance,
        updated_at = NOW();

    -- 3. Credit wallets table
    INSERT INTO public.wallets (user_id, currency, total_balance, locked_balance)
    VALUES (p_user_id, v_norm_asset, p_amount, 0.00000000)
    ON CONFLICT (user_id, currency) DO UPDATE
    SET 
        total_balance = public.wallets.total_balance + EXCLUDED.total_balance,
        updated_at = NOW();

    RETURN jsonb_build_object(
        'success', true,
        'deposit_id', v_deposit_id,
        'user_id', p_user_id,
        'amount', p_amount,
        'asset', v_norm_asset
    );
END;
$$;

-- ==============================================================================
-- 11. STORED PROCEDURE: deduct_user_balance(p_user_id, p_amount, p_asset)
-- Safely deducts available balance for user withdrawals
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.deduct_user_balance(
    p_user_id UUID,
    p_amount NUMERIC,
    p_asset TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_norm_asset TEXT;
    v_current_available NUMERIC(28, 8);
    v_balance_id UUID;
BEGIN
    IF p_amount <= 0 THEN
        RAISE EXCEPTION 'Withdrawal amount must be greater than zero.';
    END IF;

    v_norm_asset := CASE 
        WHEN p_asset ILIKE 'USDT%' THEN 'USDT'
        WHEN p_asset ILIKE 'BTC%' THEN 'BTC'
        WHEN p_asset ILIKE 'ETH%' THEN 'ETH'
        WHEN p_asset ILIKE 'LTC%' THEN 'LTC'
        ELSE UPPER(p_asset)
    END;

    -- Lock row for update
    SELECT id, available_balance INTO v_balance_id, v_current_available
    FROM public.user_balances
    WHERE user_id = p_user_id AND asset = v_norm_asset
    FOR UPDATE;

    IF v_balance_id IS NULL OR v_current_available < p_amount THEN
        -- Check wallets table as secondary fallback
        SELECT available_balance INTO v_current_available
        FROM public.wallets
        WHERE user_id = p_user_id AND currency = v_norm_asset
        FOR UPDATE;

        IF v_current_available IS NULL OR v_current_available < p_amount THEN
            RAISE EXCEPTION 'Insufficient balance. Available: %, Required: %', COALESCE(v_current_available, 0), p_amount;
        END IF;
    END IF;

    -- Deduct from user_balances
    UPDATE public.user_balances
    SET 
        available_balance = available_balance - p_amount,
        updated_at = NOW()
    WHERE user_id = p_user_id AND asset = v_norm_asset;

    -- Deduct from wallets
    UPDATE public.wallets
    SET 
        total_balance = total_balance - p_amount,
        updated_at = NOW()
    WHERE user_id = p_user_id AND currency = v_norm_asset;

    RETURN jsonb_build_object(
        'success', true,
        'user_id', p_user_id,
        'deducted_amount', p_amount,
        'asset', v_norm_asset
    );
END;
$$;

-- ==============================================================================
-- 12. ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================
ALTER TABLE public.user_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p2p_trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.escrow_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.disputes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;

-- user_balances: users can read their own balances
DROP POLICY IF EXISTS "user_balances_select_policy" ON public.user_balances;
CREATE POLICY "user_balances_select_policy" ON public.user_balances
    FOR SELECT USING (auth.uid() = user_id);

-- p2p_offers: public read for active offers, creator full access
DROP POLICY IF EXISTS "p2p_offers_public_select" ON public.p2p_offers;
CREATE POLICY "p2p_offers_public_select" ON public.p2p_offers
    FOR SELECT USING (true);

DROP POLICY IF EXISTS "p2p_offers_owner_all" ON public.p2p_offers;
CREATE POLICY "p2p_offers_owner_all" ON public.p2p_offers
    FOR ALL USING (auth.uid() = user_id);

-- p2p_trades: only buyer, seller, and admins can access trade
DROP POLICY IF EXISTS "p2p_trades_participants_select" ON public.p2p_trades;
CREATE POLICY "p2p_trades_participants_select" ON public.p2p_trades
    FOR SELECT USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

DROP POLICY IF EXISTS "p2p_trades_participants_update" ON public.p2p_trades;
CREATE POLICY "p2p_trades_participants_update" ON public.p2p_trades
    FOR UPDATE USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

-- escrow_locks: participants can view escrow status
DROP POLICY IF EXISTS "escrow_locks_participants_select" ON public.escrow_locks;
CREATE POLICY "escrow_locks_participants_select" ON public.escrow_locks
    FOR SELECT USING (auth.uid() = buyer_id OR auth.uid() = seller_id);

-- disputes: trade participants can view and open disputes
DROP POLICY IF EXISTS "disputes_participants_select" ON public.disputes;
CREATE POLICY "disputes_participants_select" ON public.disputes
    FOR SELECT USING (auth.uid() = initiator_id OR auth.uid() = respondent_id);

DROP POLICY IF EXISTS "disputes_initiator_insert" ON public.disputes;
CREATE POLICY "disputes_initiator_insert" ON public.disputes
    FOR INSERT WITH CHECK (auth.uid() = initiator_id);

-- deposits & withdrawals
DROP POLICY IF EXISTS "deposits_owner_select" ON public.deposits;
CREATE POLICY "deposits_owner_select" ON public.deposits
    FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "withdrawals_owner_select" ON public.withdrawals;
CREATE POLICY "withdrawals_owner_select" ON public.withdrawals
    FOR SELECT USING (auth.uid() = user_id);
