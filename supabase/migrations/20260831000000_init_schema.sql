-- ==============================================================================
-- 20260831000000_init_schema.sql
-- Foundational Database Schema, RLS, and Security Definer RPCs
-- Custodial Wallet & P2P Marketplace Architecture
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. EXTENSIONS
-- ------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------------------------
-- 2. TABLES & ENUMS
-- ------------------------------------------------------------------------------

-- 2.1 Profiles (extends auth.users)
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    username TEXT UNIQUE NOT NULL,
    display_name TEXT,
    avatar_url TEXT,
    country TEXT,
    preferred_currency TEXT DEFAULT 'USD',
    is_banned BOOLEAN NOT NULL DEFAULT FALSE,
    is_on_hold BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.2 App Admins & Roles
CREATE TABLE IF NOT EXISTS public.app_admins (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'admin' CHECK (role IN ('superadmin', 'admin', 'support', 'compliance')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.3 Assets & Supported Coins
CREATE TABLE IF NOT EXISTS public.assets (
    code TEXT PRIMARY KEY, -- e.g., 'BTC', 'ETH', 'USDT', 'LTC', 'XMR', 'TRX'
    name TEXT NOT NULL,
    decimals INTEGER NOT NULL DEFAULT 8 CHECK (decimals >= 0 AND decimals <= 18),
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.4 Asset Networks (e.g., USDT on TRC20, ERC20, Arbitrum, etc.)
CREATE TABLE IF NOT EXISTS public.asset_networks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_code TEXT NOT NULL REFERENCES public.assets(code) ON DELETE RESTRICT,
    network_code TEXT NOT NULL, -- e.g., 'BTC_MAINNET', 'ERC20', 'TRC20'
    min_deposit NUMERIC(36, 18) NOT NULL DEFAULT 0.0001 CHECK (min_deposit >= 0),
    min_withdrawal NUMERIC(36, 18) NOT NULL DEFAULT 0.0001 CHECK (min_withdrawal >= 0),
    network_fee NUMERIC(36, 18) NOT NULL DEFAULT 0.0 CHECK (network_fee >= 0),
    required_confirmations INTEGER NOT NULL DEFAULT 3 CHECK (required_confirmations >= 1),
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (asset_code, network_code)
);

-- 2.5 Wallets (Core custodial ledger container per user)
CREATE TABLE IF NOT EXISTS public.wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'closed')),
    provisioning_status TEXT NOT NULL DEFAULT 'pending' CHECK (provisioning_status IN ('pending', 'in_progress', 'completed', 'failed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.6 Wallet Assets (Multi-currency balance ledger with strict non-negative constraints)
CREATE TABLE IF NOT EXISTS public.wallet_assets (
    wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
    asset_code TEXT NOT NULL REFERENCES public.assets(code) ON DELETE RESTRICT,
    available NUMERIC(36, 18) NOT NULL DEFAULT 0.0 CHECK (available >= 0),
    locked_escrow NUMERIC(36, 18) NOT NULL DEFAULT 0.0 CHECK (locked_escrow >= 0),
    locked_withdrawal NUMERIC(36, 18) NOT NULL DEFAULT 0.0 CHECK (locked_withdrawal >= 0),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (wallet_id, asset_code)
);

-- 2.7 Deposit Addresses (Custodial addresses assigned to users)
CREATE TABLE IF NOT EXISTS public.deposit_addresses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    asset_code TEXT NOT NULL REFERENCES public.assets(code) ON DELETE RESTRICT,
    network_code TEXT NOT NULL,
    address TEXT UNIQUE NOT NULL,
    custody_provider TEXT NOT NULL DEFAULT 'internal',
    custody_ref TEXT,
    derivation_path TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired', 'suspended')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.8 Wallet Provisioning Queue
CREATE TABLE IF NOT EXISTS public.wallet_provisioning (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE CASCADE,
    asset_code TEXT NOT NULL REFERENCES public.assets(code) ON DELETE RESTRICT,
    network_code TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT,
    idempotency_key TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.9 Platform Wallets (Hot / Cold / Fee collection storage)
CREATE TABLE IF NOT EXISTS public.platform_wallets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role TEXT NOT NULL CHECK (role IN ('hot_wallet', 'cold_storage', 'fee_collector', 'escrow_pool')),
    asset_code TEXT NOT NULL REFERENCES public.assets(code) ON DELETE RESTRICT,
    network_code TEXT NOT NULL,
    public_address TEXT NOT NULL,
    custody_provider TEXT NOT NULL DEFAULT 'internal',
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deprecated')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.10 Deposits (On-chain / custodial incoming funds)
CREATE TABLE IF NOT EXISTS public.deposits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
    asset_code TEXT NOT NULL REFERENCES public.assets(code) ON DELETE RESTRICT,
    network_code TEXT NOT NULL,
    deposit_address_id UUID REFERENCES public.deposit_addresses(id) ON DELETE SET NULL,
    amount NUMERIC(36, 18) NOT NULL CHECK (amount > 0),
    txid TEXT NOT NULL,
    output_index INTEGER NOT NULL DEFAULT 0,
    confirmations INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('detected', 'pending', 'confirmed', 'credited', 'rejected')),
    credited_at TIMESTAMPTZ,
    idempotency_key TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.11 Withdrawals (Outgoing on-chain crypto transfers)
CREATE TABLE IF NOT EXISTS public.withdrawals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
    asset_code TEXT NOT NULL REFERENCES public.assets(code) ON DELETE RESTRICT,
    network_code TEXT NOT NULL,
    destination_address TEXT NOT NULL,
    amount NUMERIC(36, 18) NOT NULL CHECK (amount > 0),
    network_fee NUMERIC(36, 18) NOT NULL DEFAULT 0.0 CHECK (network_fee >= 0),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'broadcasting', 'broadcasted', 'completed', 'rejected', 'cancelled')),
    platform_wallet_id UUID REFERENCES public.platform_wallets(id) ON DELETE SET NULL,
    txid TEXT,
    approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    rejected_reason TEXT,
    idempotency_key TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.12 Immutable Financial Ledger Entries (Double-entry audit log)
CREATE TABLE IF NOT EXISTS public.ledger_entries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_id UUID NOT NULL REFERENCES public.wallets(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    asset_code TEXT NOT NULL REFERENCES public.assets(code) ON DELETE RESTRICT,
    delta_available NUMERIC(36, 18) NOT NULL DEFAULT 0.0,
    delta_locked NUMERIC(36, 18) NOT NULL DEFAULT 0.0,
    available_after NUMERIC(36, 18) NOT NULL CHECK (available_after >= 0),
    locked_after NUMERIC(36, 18) NOT NULL CHECK (locked_after >= 0),
    entry_type TEXT NOT NULL CHECK (entry_type IN (
        'deposit_credit',
        'withdrawal_lock',
        'withdrawal_complete',
        'withdrawal_unlock',
        'escrow_lock',
        'escrow_release',
        'escrow_refund',
        'fee_deduction',
        'internal_transfer_debit',
        'internal_transfer_credit',
        'admin_adjustment'
    )),
    ref_table TEXT NOT NULL,
    ref_id TEXT NOT NULL,
    idempotency_key TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.13 Blockchain Transactions (Raw recorded on-chain activity)
CREATE TABLE IF NOT EXISTS public.blockchain_transactions (
    network_code TEXT NOT NULL,
    txid TEXT NOT NULL,
    output_index INTEGER NOT NULL DEFAULT 0,
    to_address TEXT NOT NULL,
    from_address TEXT,
    asset_code TEXT NOT NULL REFERENCES public.assets(code) ON DELETE RESTRICT,
    amount NUMERIC(36, 18) NOT NULL CHECK (amount >= 0),
    block_height BIGINT,
    confirmations INTEGER NOT NULL DEFAULT 0,
    direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing', 'internal')),
    raw_payload JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (network_code, txid, output_index)
);

-- 2.14 Idempotency Keys (Deduplication engine)
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
    key TEXT PRIMARY KEY,
    scope TEXT NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    result JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2.15 P2P Trades (For atomic trade settlement)
CREATE TABLE IF NOT EXISTS public.trades (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    seller_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
    asset_code TEXT NOT NULL REFERENCES public.assets(code) ON DELETE RESTRICT,
    crypto_amount NUMERIC(36, 18) NOT NULL CHECK (crypto_amount > 0),
    fiat_amount NUMERIC(18, 2) NOT NULL CHECK (fiat_amount > 0),
    fiat_currency TEXT NOT NULL DEFAULT 'USD',
    platform_fee NUMERIC(36, 18) NOT NULL DEFAULT 0.0 CHECK (platform_fee >= 0),
    status TEXT NOT NULL DEFAULT 'created' CHECK (status IN ('created', 'escrow_locked', 'payment_sent', 'completed', 'disputed', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------------------------
-- 3. ROW LEVEL SECURITY (RLS) POLICIES
-- ------------------------------------------------------------------------------

-- Helper function to check if current user is an admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.app_admins
        WHERE user_id = auth.uid()
    );
$$;

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.asset_networks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposit_addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wallet_provisioning ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blockchain_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;

-- 3.1 Profiles RLS
CREATE POLICY "Public profiles are viewable by everyone" 
    ON public.profiles FOR SELECT USING (true);

CREATE POLICY "Users can update own profile" 
    ON public.profiles FOR UPDATE USING (auth.uid() = id) 
    WITH CHECK (auth.uid() = id AND is_banned = (SELECT is_banned FROM public.profiles WHERE id = auth.uid()) AND is_on_hold = (SELECT is_on_hold FROM public.profiles WHERE id = auth.uid()));

-- 3.2 App Admins RLS
CREATE POLICY "Admins can view admins table" 
    ON public.app_admins FOR SELECT USING (public.is_admin());

-- 3.3 Assets & Networks RLS (Public read-only, Admin modify)
CREATE POLICY "Assets are viewable by all users" 
    ON public.assets FOR SELECT USING (true);

CREATE POLICY "Asset networks are viewable by all users" 
    ON public.asset_networks FOR SELECT USING (true);

-- 3.4 Wallets RLS (Read-only for owner, No direct client mutations)
CREATE POLICY "Users can view own wallet" 
    ON public.wallets FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

-- 3.5 Wallet Assets RLS (Read-only for owner via wallet_id)
CREATE POLICY "Users can view own wallet assets" 
    ON public.wallet_assets FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.wallets 
            WHERE wallets.id = wallet_assets.wallet_id 
              AND (wallets.user_id = auth.uid() OR public.is_admin())
        )
    );

-- 3.6 Deposit Addresses RLS
CREATE POLICY "Users can view own deposit addresses" 
    ON public.deposit_addresses FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

-- 3.7 Wallet Provisioning RLS
CREATE POLICY "Users can view own provisioning queue" 
    ON public.wallet_provisioning FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

-- 3.8 Platform Wallets RLS (Admins only)
CREATE POLICY "Admins can view platform wallets" 
    ON public.platform_wallets FOR SELECT USING (public.is_admin());

-- 3.9 Deposits RLS (Read-only for owner, mutations via RPC/Service)
CREATE POLICY "Users can view own deposits" 
    ON public.deposits FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

-- 3.10 Withdrawals RLS (Read-only for owner, creation/mutation via RPC)
CREATE POLICY "Users can view own withdrawals" 
    ON public.withdrawals FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

-- 3.11 Ledger Entries RLS (Read-only for owner, mutations strictly via DB RPCs)
CREATE POLICY "Users can view own ledger entries" 
    ON public.ledger_entries FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

-- 3.12 Blockchain Transactions RLS
CREATE POLICY "Admins can view blockchain transactions" 
    ON public.blockchain_transactions FOR SELECT USING (public.is_admin());

-- 3.13 Idempotency Keys RLS
CREATE POLICY "Users can read own idempotency keys" 
    ON public.idempotency_keys FOR SELECT USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "Users can insert own idempotency keys" 
    ON public.idempotency_keys FOR INSERT WITH CHECK (auth.uid() = user_id);

-- 3.14 Trades RLS
CREATE POLICY "Users can view trades they participate in" 
    ON public.trades FOR SELECT USING (auth.uid() = buyer_id OR auth.uid() = seller_id OR public.is_admin());

-- ------------------------------------------------------------------------------
-- 4. SECURITY DEFINER RPC FUNCTIONS & TRIGGERS
-- ------------------------------------------------------------------------------

-- 4.1 Trigger: Handle New User Registration
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_username TEXT;
    v_wallet_id UUID;
    v_asset RECORD;
BEGIN
    -- Extract username from metadata or fallback to user prefix
    v_username := COALESCE(
        NEW.raw_user_meta_data->>'username',
        'user_' || SUBSTRING(NEW.id::TEXT, 1, 8)
    );

    -- Ensure unique username fallback if collision
    WHILE EXISTS (SELECT 1 FROM public.profiles WHERE username = v_username) LOOP
        v_username := 'user_' || SUBSTRING(gen_random_uuid()::TEXT, 1, 8);
    END LOOP;

    -- 1. Create Profile
    INSERT INTO public.profiles (id, username, display_name, avatar_url)
    VALUES (
        NEW.id,
        v_username,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', v_username),
        NEW.raw_user_meta_data->>'avatar_url'
    );

    -- 2. Create Core Wallet
    INSERT INTO public.wallets (user_id, status, provisioning_status)
    VALUES (NEW.id, 'active', 'pending')
    RETURNING id INTO v_wallet_id;

    -- 3. Initialize wallet_assets for all enabled assets
    FOR v_asset IN SELECT code FROM public.assets WHERE is_enabled = TRUE LOOP
        INSERT INTO public.wallet_assets (wallet_id, asset_code, available, locked_escrow, locked_withdrawal)
        VALUES (v_wallet_id, v_asset.code, 0.0, 0.0, 0.0)
        ON CONFLICT (wallet_id, asset_code) DO NOTHING;
    END LOOP;

    -- 4. Enqueue address provisioning jobs for each active asset network
    INSERT INTO public.wallet_provisioning (user_id, wallet_id, asset_code, network_code, status, idempotency_key)
    SELECT 
        NEW.id, 
        v_wallet_id, 
        an.asset_code, 
        an.network_code, 
        'queued', 
        'prov_' || NEW.id::TEXT || '_' || an.asset_code || '_' || an.network_code
    FROM public.asset_networks an
    WHERE an.is_enabled = TRUE
    ON CONFLICT (idempotency_key) DO NOTHING;

    RETURN NEW;
END;
$$;

-- Trigger hook on auth.users table
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- 4.2 RPC: Request Withdrawal (Locks funds & records immutable ledger)
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
SET search_path = public
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_wallet_id UUID;
    v_available NUMERIC(36, 18);
    v_locked_withdrawal NUMERIC(36, 18);
    v_network_fee NUMERIC(36, 18);
    v_min_withdrawal NUMERIC(36, 18);
    v_withdrawal_id UUID;
    v_existing_id UUID;
    v_is_banned BOOLEAN;
    v_is_on_hold BOOLEAN;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- Check user profile status
    SELECT is_banned, is_on_hold INTO v_is_banned, v_is_on_hold
    FROM public.profiles
    WHERE id = v_user_id;

    IF v_is_banned OR v_is_on_hold THEN
        RAISE EXCEPTION 'Account is restricted from making withdrawals.';
    END IF;

    -- Check Idempotency
    SELECT id INTO v_existing_id FROM public.withdrawals WHERE idempotency_key = p_idempotency_key;
    IF v_existing_id IS NOT NULL THEN
        RETURN jsonb_build_object('success', true, 'withdrawal_id', v_existing_id, 'status', 'idempotent_duplicate');
    END IF;

    -- Fetch network validation rules
    SELECT network_fee, min_withdrawal INTO v_network_fee, v_min_withdrawal
    FROM public.asset_networks
    WHERE asset_code = p_asset_code AND network_code = p_network_code AND is_enabled = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unsupported asset or network: % / %', p_asset_code, p_network_code;
    END IF;

    IF p_amount < v_min_withdrawal THEN
        RAISE EXCEPTION 'Withdrawal amount % is below minimum limit %', p_amount, v_min_withdrawal;
    END IF;

    -- Fetch wallet & lock row for update
    SELECT id INTO v_wallet_id FROM public.wallets WHERE user_id = v_user_id AND status = 'active';
    IF v_wallet_id IS NULL THEN
        RAISE EXCEPTION 'Active wallet not found.';
    END IF;

    SELECT available, locked_withdrawal INTO v_available, v_locked_withdrawal
    FROM public.wallet_assets
    WHERE wallet_id = v_wallet_id AND asset_code = p_asset_code
    FOR UPDATE;

    IF v_available IS NULL OR v_available < (p_amount + v_network_fee) THEN
        RAISE EXCEPTION 'Insufficient balance. Available: %, Requested: %, Fee: %', COALESCE(v_available, 0), p_amount, v_network_fee;
    END IF;

    -- 1. Deduct available balance and add to locked_withdrawal
    UPDATE public.wallet_assets
    SET available = available - (p_amount + v_network_fee),
        locked_withdrawal = locked_withdrawal + (p_amount + v_network_fee),
        updated_at = NOW()
    WHERE wallet_id = v_wallet_id AND asset_code = p_asset_code;

    -- 2. Create Pending Withdrawal record
    INSERT INTO public.withdrawals (
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
        v_user_id,
        v_wallet_id,
        p_asset_code,
        p_network_code,
        p_destination_address,
        p_amount,
        v_network_fee,
        'pending',
        p_idempotency_key
    )
    RETURNING id INTO v_withdrawal_id;

    -- 3. Write Immutable Ledger Entry
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
        p_asset_code,
        -(p_amount + v_network_fee),
        +(p_amount + v_network_fee),
        v_available - (p_amount + v_network_fee),
        v_locked_withdrawal + (p_amount + v_network_fee),
        'withdrawal_lock',
        'withdrawals',
        v_withdrawal_id::TEXT,
        'ledger_wlock_' || p_idempotency_key
    );

    RETURN jsonb_build_object(
        'success', true,
        'withdrawal_id', v_withdrawal_id,
        'amount', p_amount,
        'network_fee', v_network_fee,
        'status', 'pending'
    );
END;
$$;


-- 4.3 RPC: Complete P2P Trade (Atomic Escrow Release + Credit + Fee Accounting)
CREATE OR REPLACE FUNCTION public.complete_trade(p_trade_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_caller_id UUID := auth.uid();
    v_trade RECORD;
    v_seller_wallet_id UUID;
    v_buyer_wallet_id UUID;
    v_seller_locked NUMERIC(36, 18);
    v_seller_available NUMERIC(36, 18);
    v_buyer_available NUMERIC(36, 18);
    v_buyer_locked NUMERIC(36, 18);
    v_total_deduction NUMERIC(36, 18);
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- 1. Fetch & lock trade
    SELECT * INTO v_trade
    FROM public.trades
    WHERE id = p_trade_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Trade % not found.', p_trade_id;
    END IF;

    -- Only the seller or an authorized admin can release escrow
    IF v_trade.seller_id <> v_caller_id AND NOT public.is_admin() THEN
        RAISE EXCEPTION 'Only the seller or admin can complete the trade.';
    END IF;

    IF v_trade.status NOT IN ('escrow_locked', 'payment_sent', 'disputed') THEN
        RAISE EXCEPTION 'Trade status (%) cannot be completed.', v_trade.status;
    END IF;

    v_total_deduction := v_trade.crypto_amount + v_trade.platform_fee;

    -- 2. Fetch Seller & Buyer wallets
    SELECT id INTO v_seller_wallet_id FROM public.wallets WHERE user_id = v_trade.seller_id;
    SELECT id INTO v_buyer_wallet_id FROM public.wallets WHERE user_id = v_trade.buyer_id;

    IF v_seller_wallet_id IS NULL OR v_buyer_wallet_id IS NULL THEN
        RAISE EXCEPTION 'Wallet records missing for trade participants.';
    END IF;

    -- 3. Lock Seller wallet asset row
    SELECT available, locked_escrow INTO v_seller_available, v_seller_locked
    FROM public.wallet_assets
    WHERE wallet_id = v_seller_wallet_id AND asset_code = v_trade.asset_code
    FOR UPDATE;

    IF v_seller_locked < v_total_deduction THEN
        RAISE EXCEPTION 'Corrupted escrow state: locked_escrow (%) < deduction (%)', v_seller_locked, v_total_deduction;
    END IF;

    -- 4. Deduct from Seller locked_escrow
    UPDATE public.wallet_assets
    SET locked_escrow = locked_escrow - v_total_deduction,
        updated_at = NOW()
    WHERE wallet_id = v_seller_wallet_id AND asset_code = v_trade.asset_code;

    -- 5. Lock Buyer wallet asset row & credit available crypto
    SELECT available, locked_escrow INTO v_buyer_available, v_buyer_locked
    FROM public.wallet_assets
    WHERE wallet_id = v_buyer_wallet_id AND asset_code = v_trade.asset_code
    FOR UPDATE;

    UPDATE public.wallet_assets
    SET available = available + v_trade.crypto_amount,
        updated_at = NOW()
    WHERE wallet_id = v_buyer_wallet_id AND asset_code = v_trade.asset_code;

    -- 6. Record Seller Ledger Entry (Escrow release)
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
        v_seller_wallet_id,
        v_trade.seller_id,
        v_trade.asset_code,
        0.0,
        -v_total_deduction,
        v_seller_available,
        v_seller_locked - v_total_deduction,
        'escrow_release',
        'trades',
        v_trade.id::TEXT,
        'ledger_trade_seller_' || v_trade.id::TEXT
    );

    -- 7. Record Buyer Ledger Entry (Crypto credit)
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
        v_buyer_wallet_id,
        v_trade.buyer_id,
        v_trade.asset_code,
        +v_trade.crypto_amount,
        0.0,
        v_buyer_available + v_trade.crypto_amount,
        v_buyer_locked,
        'escrow_release',
        'trades',
        v_trade.id::TEXT,
        'ledger_trade_buyer_' || v_trade.id::TEXT
    );

    -- 8. Mark trade completed
    UPDATE public.trades
    SET status = 'completed',
        updated_at = NOW()
    WHERE id = p_trade_id;

    RETURN jsonb_build_object(
        'success', true,
        'trade_id', p_trade_id,
        'credited_amount', v_trade.crypto_amount,
        'fee', v_trade.platform_fee,
        'status', 'completed'
    );
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. SEED DATA (Base Supported Assets & Networks)
-- ------------------------------------------------------------------------------
INSERT INTO public.assets (code, name, decimals, is_enabled) VALUES
('BTC', 'Bitcoin', 8, true),
('ETH', 'Ethereum', 18, true),
('USDT', 'Tether USD', 6, true),
('USDC', 'USD Coin', 6, true),
('LTC', 'Litecoin', 8, true),
('TRX', 'Tron', 6, true),
('XMR', 'Monero', 12, true)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.asset_networks (asset_code, network_code, min_deposit, min_withdrawal, network_fee, required_confirmations, is_enabled) VALUES
('BTC', 'BTC_MAINNET', 0.0002, 0.0005, 0.0001, 2, true),
('ETH', 'ERC20', 0.005, 0.01, 0.002, 12, true),
('USDT', 'TRC20', 5.0, 10.0, 1.5, 15, true),
('USDT', 'ERC20', 20.0, 50.0, 5.0, 12, true),
('USDC', 'ERC20', 20.0, 50.0, 5.0, 12, true),
('LTC', 'LTC_MAINNET', 0.02, 0.05, 0.001, 6, true),
('TRX', 'TRC20', 20.0, 50.0, 2.0, 15, true),
('XMR', 'XMR_MAINNET', 0.01, 0.02, 0.0005, 10, true)
ON CONFLICT (asset_code, network_code) DO NOTHING;
