-- ============================================================================
-- Supabase Migration: 20261005030000_enforce_individual_emergency_freeze_financial_rpcs.sql
-- Description: Enforces authoritative database-level individual emergency freeze
--              in the three canonical financial RPCs:
--              1. public.initiate_trade_with_escrow
--              2. public.request_withdrawal
--              3. public.execute_internal_transfer
--              Uses deterministic row locking (profiles FOR UPDATE) and raises
--              USER_EMERGENCY_FROZEN before any financial or escrow mutations.
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. CANONICAL initiate_trade_with_escrow WITH INDIVIDUAL EMERGENCY FREEZE
-- ============================================================================
DROP FUNCTION IF EXISTS public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.initiate_trade_with_escrow(
    p_ad_id TEXT,
    p_crypto_amount NUMERIC,
    p_fiat_amount NUMERIC,
    p_fiat_currency TEXT,
    p_price NUMERIC,
    p_payment_method TEXT,
    p_trade_ref TEXT DEFAULT NULL,
    p_idempotency_key TEXT DEFAULT NULL,
    p_caller_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_effective_caller UUID;

    -- Strongly-typed record variables for each relation
    v_p2p_ad public.p2p_ads%ROWTYPE;
    v_legacy_ad public.ads%ROWTYPE;

    -- Normalized scalar variables
    v_found_ad BOOLEAN := FALSE;
    v_ad_id UUID := NULL;
    v_ad_user_id UUID := NULL;
    v_ad_type TEXT := 'SELL';
    v_ad_asset TEXT := 'USDT';
    v_ad_price NUMERIC(36, 18) := 1.0;
    v_ad_fiat_currency TEXT := 'USD';
    v_ad_payment_window_mins INTEGER := 30;
    v_ad_is_active BOOLEAN := TRUE;
    v_ad_source TEXT := NULL;

    -- Counterparties & Financials
    v_buyer_id UUID;
    v_seller_id UUID;
    v_unit_price NUMERIC(36, 18);
    v_crypto_amount NUMERIC(36, 18);
    v_fiat_amount NUMERIC(18, 2);
    v_fiat_currency TEXT;
    v_escrow_fee NUMERIC(36, 18);
    v_total_escrow NUMERIC(36, 18);

    -- Identifiers & Wallets
    v_trade_id UUID;
    v_public_id TEXT;
    v_trade_ad_id VARCHAR := NULL;
    v_ad_public_ad_id TEXT := NULL;
    v_seller_wallet_asset_id UUID;
    v_seller_bal NUMERIC(36, 18);
    v_seller_escrow NUMERIC(36, 18);
    v_seller_bal_after NUMERIC(36, 18);
    v_seller_escrow_after NUMERIC(36, 18);
    v_existing_trade RECORD;

    -- Global Emergency Control Variables
    v_prevent_new_trades_val JSONB := NULL;
    v_maintenance_mode_val JSONB := NULL;
    v_prevent_new_trades BOOLEAN := NULL;
    v_maintenance_mode BOOLEAN := NULL;
    v_setting_rec RECORD;
    v_read_count INTEGER := 0;
    v_is_caller_admin BOOLEAN := FALSE;

    -- Individual Emergency Freeze Variables
    v_caller_frozen BOOLEAN := FALSE;
    v_counterparty_frozen BOOLEAN := FALSE;
BEGIN
    -- 1. Strict Authentication & Authorization Enforcement
    IF v_auth_uid IS NOT NULL THEN
        IF p_caller_id IS NOT NULL AND p_caller_id <> v_auth_uid THEN
            RAISE EXCEPTION 'Caller ID mismatch: unauthorized impersonation.';
        END IF;
        v_effective_caller := v_auth_uid;
    ELSE
        IF p_caller_id IS NULL THEN
            RAISE EXCEPTION 'Authentication required: neither session token nor trusted caller ID provided.';
        END IF;
        v_effective_caller := p_caller_id;
    END IF;

    -- =========================================================================
    -- 2. AUTHORITATIVE DATABASE-LEVEL EMERGENCY FREEZE CHECK (system_settings)
    -- Must execute BEFORE any ad lookup, balance checks, or escrow locking.
    -- FAIL CLOSED: If controls cannot be read, verified, or parsed, REJECT trade.
    -- =========================================================================
    FOR v_setting_rec IN
        SELECT key, value
        FROM public.system_settings
        WHERE key IN ('prevent_new_trades', 'maintenance_mode')
    LOOP
        v_read_count := v_read_count + 1;
        IF v_setting_rec.key = 'prevent_new_trades' THEN
            v_prevent_new_trades_val := v_setting_rec.value;
        ELSIF v_setting_rec.key = 'maintenance_mode' THEN
            v_maintenance_mode_val := v_setting_rec.value;
        END IF;
    END LOOP;

    -- FAIL CLOSED: Both required keys ('prevent_new_trades' AND 'maintenance_mode') MUST exist
    IF v_prevent_new_trades_val IS NULL OR v_maintenance_mode_val IS NULL OR v_read_count < 2 THEN
        RAISE EXCEPTION 'Platform emergency control state is unavailable. Trade creation rejected for security reasons.'
            USING ERRCODE = 'P0001', DETAIL = 'PLATFORM_CONTROL_STATE_UNAVAILABLE';
    END IF;

    -- Safely parse prevent_new_trades JSONB value
    IF jsonb_typeof(v_prevent_new_trades_val) = 'boolean' THEN
        v_prevent_new_trades := (v_prevent_new_trades_val)::boolean;
    ELSIF jsonb_typeof(v_prevent_new_trades_val) = 'string' THEN
        v_prevent_new_trades := (LOWER(v_prevent_new_trades_val #>> '{}') IN ('true', '1', 't'));
    ELSE
        RAISE EXCEPTION 'Invalid platform control value type for prevent_new_trades. Trade creation rejected.'
            USING ERRCODE = 'P0001', DETAIL = 'PLATFORM_CONTROL_STATE_UNAVAILABLE';
    END IF;

    -- Safely parse maintenance_mode JSONB value
    IF jsonb_typeof(v_maintenance_mode_val) = 'boolean' THEN
        v_maintenance_mode := (v_maintenance_mode_val)::boolean;
    ELSIF jsonb_typeof(v_maintenance_mode_val) = 'string' THEN
        v_maintenance_mode := (LOWER(v_maintenance_mode_val #>> '{}') IN ('true', '1', 't'));
    ELSE
        RAISE EXCEPTION 'Invalid platform control value type for maintenance_mode. Trade creation rejected.'
            USING ERRCODE = 'P0001', DETAIL = 'PLATFORM_CONTROL_STATE_UNAVAILABLE';
    END IF;

    -- Double check booleans are non-null after parsing
    IF v_prevent_new_trades IS NULL OR v_maintenance_mode IS NULL THEN
        RAISE EXCEPTION 'Unresolvable platform control booleans. Trade creation rejected.'
            USING ERRCODE = 'P0001', DETAIL = 'PLATFORM_CONTROL_STATE_UNAVAILABLE';
    END IF;

    -- RULE A: prevent_new_trades = TRUE -> BLOCK ALL USERS (NO ADMIN EXEMPTION)
    IF v_prevent_new_trades THEN
        RAISE EXCEPTION 'Initiating new P2P trades is temporarily disabled by administrator.'
            USING ERRCODE = 'P0001', DETAIL = 'P2P_TRADE_CREATION_DISABLED';
    END IF;

    -- RULE B: maintenance_mode = TRUE -> BLOCK NORMAL USERS; ALLOW ADMINS FOR TESTING
    IF v_maintenance_mode THEN
        SELECT EXISTS (
            SELECT 1 FROM public.profiles
            WHERE id = v_effective_caller
              AND (role = 'admin' OR is_admin = TRUE OR is_admin_account = TRUE)
        ) INTO v_is_caller_admin;

        IF NOT v_is_caller_admin THEN
            RAISE EXCEPTION 'Platform is currently undergoing scheduled maintenance. Initiating new trades is temporarily disabled.'
                USING ERRCODE = 'P0001', DETAIL = 'PLATFORM_MAINTENANCE_MODE';
        END IF;
    END IF;

    -- =========================================================================
    -- 1.3 PENDING WITHDRAWAL APPROVAL LOCKOUT CHECK
    -- =========================================================================
    IF EXISTS (
        SELECT 1 FROM pg_proc p 
        JOIN pg_namespace n ON n.oid = p.pronamespace 
        WHERE n.nspname = 'public' AND p.proname = 'has_pending_withdrawal_approval'
    ) THEN
        IF public.has_pending_withdrawal_approval(v_effective_caller) THEN
            RAISE EXCEPTION 'WITHDRAWAL_APPROVAL_PENDING: You have a pending withdrawal awaiting administrator approval. You cannot initiate new trades until it is processed.'
                USING ERRCODE = 'P0001', DETAIL = 'WITHDRAWAL_APPROVAL_PENDING';
        END IF;
    END IF;

    -- 2. Lookup in Canonical public.p2p_ads Table
    IF p_ad_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        SELECT * INTO v_p2p_ad
        FROM public.p2p_ads
        WHERE id = p_ad_id::UUID
           OR public_ad_id = p_ad_id
        LIMIT 1;
    ELSE
        SELECT * INTO v_p2p_ad
        FROM public.p2p_ads
        WHERE public_ad_id = p_ad_id
           OR id::TEXT = p_ad_id
        LIMIT 1;
    END IF;

    IF v_p2p_ad.id IS NOT NULL THEN
        v_found_ad := TRUE;
        v_ad_id := v_p2p_ad.id;
        v_ad_user_id := v_p2p_ad.user_id;
        v_ad_public_ad_id := v_p2p_ad.public_ad_id;

        -- Resolve corresponding legacy public.ads.id strictly for foreign key trades_ad_id_fkey
        SELECT id INTO v_trade_ad_id
        FROM public.ads
        WHERE public_ad_id = v_p2p_ad.public_ad_id
           OR id = v_p2p_ad.id::TEXT
        LIMIT 1;

        v_ad_type := UPPER(COALESCE(
            v_p2p_ad.ad_type,
            v_p2p_ad.type,
            'SELL'
        ));

        v_ad_asset := UPPER(COALESCE(
            v_p2p_ad.asset_symbol,
            v_p2p_ad.crypto_currency,
            v_p2p_ad.coin,
            'USDT'
        ));

        v_ad_price := COALESCE(
            NULLIF(p_price, 0),
            v_p2p_ad.price,
            1.0
        );

        v_ad_fiat_currency := UPPER(COALESCE(
            NULLIF(p_fiat_currency, ''),
            v_p2p_ad.fiat_currency,
            v_p2p_ad.fiat_symbol,
            'USD'
        ));

        v_ad_payment_window_mins := 30;

        v_ad_is_active := COALESCE(v_p2p_ad.active, TRUE)
                      AND COALESCE(v_p2p_ad.is_active, TRUE)
                      AND NOT COALESCE(v_p2p_ad.is_deleted, FALSE)
                      AND UPPER(COALESCE(v_p2p_ad.status, 'ACTIVE')) = 'ACTIVE';

        v_ad_source := 'p2p_ads';
    END IF;

    -- 3. Fallback Lookup in Legacy public.ads Table (if not found in p2p_ads)
    IF NOT v_found_ad THEN
        SELECT * INTO v_legacy_ad
        FROM public.ads
        WHERE public_id = p_ad_id
           OR public_ad_id = p_ad_id
           OR id = p_ad_id
        LIMIT 1;

        IF v_legacy_ad.id IS NOT NULL THEN
            v_found_ad := TRUE;
            v_ad_user_id := v_legacy_ad.user_id;
            v_trade_ad_id := v_legacy_ad.id;
            v_ad_public_ad_id := v_legacy_ad.public_ad_id;

            IF v_legacy_ad.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
                v_ad_id := v_legacy_ad.id::UUID;
            ELSIF v_legacy_ad.public_ad_id IS NOT NULL THEN
                SELECT pa.id INTO v_ad_id
                FROM public.p2p_ads pa
                WHERE pa.public_ad_id = v_legacy_ad.public_ad_id
                LIMIT 1;
            ELSE
                v_ad_id := NULL;
            END IF;

            v_ad_type := UPPER(COALESCE(
                v_legacy_ad.type,
                'SELL'
            ));

            v_ad_asset := UPPER(COALESCE(
                v_legacy_ad.asset_symbol,
                v_legacy_ad.asset,
                v_legacy_ad.coin,
                v_legacy_ad.token_symbol,
                v_legacy_ad.crypto_currency,
                'USDT'
            ));

            v_ad_price := COALESCE(
                NULLIF(p_price, 0),
                v_legacy_ad.price,
                v_legacy_ad.unit_price,
                v_legacy_ad.fixed_rate,
                1.0
            );

            v_ad_fiat_currency := UPPER(COALESCE(
                NULLIF(p_fiat_currency, ''),
                v_legacy_ad.fiat_currency,
                v_legacy_ad.fiat_symbol,
                v_legacy_ad.currency,
                'USD'
            ));

            v_ad_payment_window_mins := COALESCE(
                v_legacy_ad.payment_window_minutes,
                v_legacy_ad.payment_window,
                v_legacy_ad.payment_time_limit,
                30
            );

            v_ad_is_active := COALESCE(v_legacy_ad.active, TRUE)
                          AND COALESCE(v_legacy_ad.is_active, TRUE)
                          AND NOT COALESCE(v_legacy_ad.is_deleted, FALSE)
                          AND UPPER(COALESCE(v_legacy_ad.status, 'ACTIVE')) = 'ACTIVE';

            v_ad_source := 'ads';
        END IF;
    END IF;

    -- 4. Active Status & Existence Checks
    IF NOT v_found_ad THEN
        RAISE EXCEPTION 'Advertisement % not found.', p_ad_id;
    END IF;

    IF NOT v_ad_is_active THEN
        RAISE EXCEPTION 'Advertisement % is currently inactive.', p_ad_id;
    END IF;

    IF v_ad_user_id = v_effective_caller THEN
        RAISE EXCEPTION 'You cannot trade with your own advertisement.';
    END IF;

    -- Bounded Payment Window
    IF v_ad_payment_window_mins < 15 OR v_ad_payment_window_mins > 360 THEN
        v_ad_payment_window_mins := 30;
    END IF;

    -- Positive Price Check
    IF v_ad_price <= 0 THEN
        v_ad_price := 1.0;
    END IF;

    -- 5. Determine Trade Counterparties based on Normalized Ad Type
    IF v_ad_type = 'BUY' THEN
        -- Ad creator is BUYING crypto -> Counterparty (caller) is SELLING crypto
        v_seller_id := v_effective_caller;
        v_buyer_id := v_ad_user_id;
    ELSE
        -- Ad creator is SELLING crypto -> Counterparty (caller) is BUYING crypto
        v_seller_id := v_ad_user_id;
        v_buyer_id := v_effective_caller;
    END IF;

    -- =========================================================================
    -- 5.1 DETERMINISTIC ROW LOCKING & AUTHORITATIVE EMERGENCY FREEZE VERIFICATION
    -- To eliminate deadlock (PostgreSQL 40P01) from reciprocal concurrent trades,
    -- lock profiles in consistent lexicographical UUID order (smaller UUID first).
    -- Both caller and counterparty profiles are locked FOR UPDATE and authoritatively checked.
    -- =========================================================================
    IF v_effective_caller < v_ad_user_id THEN
        SELECT COALESCE(is_emergency_frozen, FALSE) INTO v_caller_frozen
        FROM public.profiles
        WHERE id = v_effective_caller
        FOR UPDATE;

        SELECT COALESCE(is_emergency_frozen, FALSE) INTO v_counterparty_frozen
        FROM public.profiles
        WHERE id = v_ad_user_id
        FOR UPDATE;
    ELSE
        SELECT COALESCE(is_emergency_frozen, FALSE) INTO v_counterparty_frozen
        FROM public.profiles
        WHERE id = v_ad_user_id
        FOR UPDATE;

        SELECT COALESCE(is_emergency_frozen, FALSE) INTO v_caller_frozen
        FROM public.profiles
        WHERE id = v_effective_caller
        FOR UPDATE;
    END IF;

    IF v_caller_frozen THEN
        RAISE EXCEPTION 'USER_EMERGENCY_FROZEN: Your account is currently under an emergency security freeze.'
            USING ERRCODE = 'P0001', DETAIL = 'USER_EMERGENCY_FROZEN';
    END IF;

    IF v_counterparty_frozen THEN
        RAISE EXCEPTION 'USER_EMERGENCY_FROZEN: The counterparty account is currently under an emergency security freeze.'
            USING ERRCODE = 'P0001', DETAIL = 'USER_EMERGENCY_FROZEN';
    END IF;

    -- 6. Financial Calculations (Authoritative 1.5% Escrow Fee)
    v_unit_price := v_ad_price;
    v_fiat_currency := v_ad_fiat_currency;

    v_crypto_amount := ROUND(COALESCE(p_crypto_amount, 0), 8);
    IF v_crypto_amount <= 0 AND p_fiat_amount > 0 THEN
        v_crypto_amount := ROUND((p_fiat_amount / v_unit_price), 8);
    END IF;

    IF v_crypto_amount <= 0 THEN
        RAISE EXCEPTION 'Invalid crypto amount: %', p_crypto_amount;
    END IF;

    v_fiat_amount := ROUND((v_crypto_amount * v_unit_price), 2);
    v_escrow_fee := ROUND(v_crypto_amount * 0.015, 8);
    v_total_escrow := v_crypto_amount + v_escrow_fee;

    v_public_id := COALESCE(p_trade_ref, 'TX' || SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 8));

    -- 7. Idempotency Check on Trade Ref / Idempotency Key
    IF p_idempotency_key IS NOT NULL THEN
        SELECT * INTO v_existing_trade
        FROM public.trades
        WHERE public_id = p_idempotency_key OR trade_id = p_idempotency_key OR public_id = v_public_id
        LIMIT 1;

        IF v_existing_trade.id IS NOT NULL THEN
            RETURN jsonb_build_object(
                'success', true,
                'trade_id', v_existing_trade.id,
                'public_id', v_existing_trade.public_id,
                'buyer_id', v_existing_trade.buyer_id,
                'seller_id', v_existing_trade.seller_id,
                'crypto_amount', v_existing_trade.crypto_amount,
                'escrow_fee', v_existing_trade.escrow_fee,
                'fiat_amount', v_existing_trade.fiat_amount,
                'fiat_currency', v_existing_trade.fiat_currency,
                'asset', v_existing_trade.crypto,
                'status', v_existing_trade.status,
                'escrow_status', v_existing_trade.escrow_status,
                'message', 'Trade already initiated (idempotent replay)'
            );
        END IF;
    END IF;

    -- 8. Ensure Buyer wallet_assets Record Exists
    INSERT INTO public.wallet_assets (
        user_id,
        asset_symbol,
        balance,
        in_escrow,
        created_at,
        updated_at
    )
    VALUES (
        v_buyer_id,
        v_ad_asset,
        0.0,
        0.0,
        NOW(),
        NOW()
    )
    ON CONFLICT (user_id, asset_symbol) DO NOTHING;

    -- Lock Seller wallet_assets Record strictly by user_id and asset_symbol FOR UPDATE
    SELECT
        id,
        balance,
        in_escrow
    INTO
        v_seller_wallet_asset_id,
        v_seller_bal,
        v_seller_escrow
    FROM public.wallet_assets
    WHERE user_id = v_seller_id
      AND asset_symbol = v_ad_asset
    FOR UPDATE;

    IF v_seller_wallet_asset_id IS NULL THEN
        RAISE EXCEPTION 'Seller wallet_assets record not found for user % and asset %', v_seller_id, v_ad_asset;
    END IF;

    IF v_seller_bal < v_total_escrow THEN
        RAISE EXCEPTION 'Insufficient spendable balance to fund escrow. Required: % % (including 1.5%% fee), Available: % %',
            v_total_escrow, v_ad_asset, v_seller_bal, v_ad_asset;
    END IF;

    -- 9. Generate Trade UUID
    v_trade_id := gen_random_uuid();

    -- 10. Atomic Balance Mutation Pinned to the Single Selected Primary Key
    UPDATE public.wallet_assets
    SET
        balance = balance - v_total_escrow,
        in_escrow = in_escrow + v_total_escrow,
        updated_at = NOW()
    WHERE id = v_seller_wallet_asset_id
      AND balance >= v_total_escrow
    RETURNING
        balance,
        in_escrow
    INTO
        v_seller_bal_after,
        v_seller_escrow_after;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Fail-closed: could not lock escrow on seller wallet_assets for trade %', v_trade_id;
    END IF;

    -- 11. Record Double-Entry Escrow Lock Ledger Entry (Live Schema Compatible)
    INSERT INTO public.ledger_entries (
        user_id,
        crypto,
        asset,
        amount,
        type,
        reference_id,
        balance_after,
        metadata,
        status
    ) VALUES (
        v_seller_id,
        v_ad_asset,
        v_ad_asset,
        -v_total_escrow,
        'transfer',
        'trade:' || v_trade_id::TEXT,
        v_seller_bal_after,
        jsonb_build_object(
            'action', 'escrow_lock',
            'trade_id', v_trade_id,
            'escrow_fee', v_escrow_fee,
            'crypto_amount', v_crypto_amount,
            'total_escrow', v_total_escrow
        ),
        'completed'
    );

    -- 12. Insert Authoritative Trade Record (Strictly Live Columns Only)
    INSERT INTO public.trades (
        id,
        public_id,
        trade_id,
        ad_id,
        buyer_id,
        seller_id,
        crypto,
        asset_code,
        crypto_currency,
        crypto_amount,
        amount,
        escrow_fee,
        fiat_amount,
        total_fiat,
        fiat_currency,
        price,
        unit_price,
        rate,
        payment_method,
        status,
        escrow_status,
        payment_window_minutes,
        created_at,
        expires_at,
        updated_at,
        public_ad_id
    ) VALUES (
        v_trade_id,
        v_public_id,
        v_public_id,
        v_trade_ad_id,
        v_buyer_id::TEXT,
        v_seller_id::TEXT,
        v_ad_asset,
        v_ad_asset,
        v_ad_asset,
        v_crypto_amount,
        v_crypto_amount,
        v_escrow_fee,
        v_fiat_amount,
        v_fiat_amount,
        v_fiat_currency,
        v_unit_price,
        v_unit_price,
        v_unit_price,
        COALESCE(p_payment_method, 'Bank Transfer'),
        'pending'::trade_status,
        'ESCROW_LOCKED',
        v_ad_payment_window_mins,
        NOW(),
        NOW() + (v_ad_payment_window_mins || ' minutes')::INTERVAL,
        NOW(),
        v_ad_public_ad_id
    );

    RETURN jsonb_build_object(
        'success', true,
        'trade_id', v_trade_id,
        'public_id', v_public_id,
        'buyer_id', v_buyer_id,
        'seller_id', v_seller_id,
        'crypto_amount', v_crypto_amount,
        'escrow_fee', v_escrow_fee,
        'fiat_amount', v_fiat_amount,
        'fiat_currency', v_fiat_currency,
        'asset', v_ad_asset,
        'status', 'pending',
        'escrow_status', 'ESCROW_LOCKED',
        'expires_at', (NOW() + (v_ad_payment_window_mins || ' minutes')::INTERVAL)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID) TO authenticated, service_role, postgres;

-- ============================================================================
-- 2. CANONICAL request_withdrawal WITH INDIVIDUAL EMERGENCY FREEZE
-- ============================================================================
CREATE OR REPLACE FUNCTION public.request_withdrawal(
    p_user_id UUID,
    p_network TEXT,
    p_to_address TEXT,
    p_amount NUMERIC(36, 18),
    p_fee NUMERIC(36, 18),
    p_asset TEXT DEFAULT 'USDT',
    p_usd_equivalent NUMERIC(18, 2) DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_wallet_id UUID;
    v_balance NUMERIC(36, 18);
    v_in_withdrawal NUMERIC(36, 18);
    v_total_deduct NUMERIC(36, 18);
    v_withdrawal_id UUID;
    v_asset_clean TEXT := UPPER(TRIM(p_asset));
    v_network_clean TEXT := UPPER(TRIM(p_network));
    
    -- User profile fields
    v_is_banned BOOLEAN := FALSE;
    v_is_on_hold BOOLEAN := FALSE;
    v_is_withdrawal_locked BOOLEAN := FALSE;
    v_is_emergency_frozen BOOLEAN := FALSE;
    v_account_status TEXT;
    v_kyc_status TEXT;
    v_is_verified BOOLEAN := FALSE;
    v_id_verified BOOLEAN := FALSE;
    v_password_changed_at TIMESTAMPTZ := NULL;
    
    -- Platform Governance Limits
    v_max_single_usd NUMERIC(18, 2) := 4000.00;
    v_approval_threshold_usd NUMERIC(18, 2) := 2000.00;
    v_daily_limit_usd NUMERIC(18, 2) := 10000.00;
    v_pwd_hold_hours NUMERIC(5, 2) := 24.00;
    v_withdrawals_enabled BOOLEAN := TRUE;
    v_kill_switch BOOLEAN := FALSE;
    
    -- Rolling 24h calculation
    v_rolling_24h_usd NUMERIC(18, 2) := 0;
    v_effective_usd NUMERIC(18, 2) := 0;
    v_requires_approval BOOLEAN := FALSE;
    v_initial_status TEXT := 'QUEUED';
    v_onchain_status TEXT := 'PENDING';
BEGIN
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'User ID is required';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Withdrawal amount must be greater than zero';
    END IF;

    -- Validate Supported Production Assets & Networks ONLY (No Polygon USDT)
    IF v_asset_clean = 'USDT' THEN
        IF v_network_clean NOT IN ('TRC20', 'TRON', 'ERC20', 'ETH', 'ETHEREUM', 'BEP20', 'BSC', 'BINANCE') THEN
            RAISE EXCEPTION 'Unsupported network % for USDT withdrawal. Supported: TRC20, ERC20, BEP20', p_network;
        END IF;
    ELSIF v_asset_clean = 'BTC' THEN
        IF v_network_clean NOT IN ('BTC', 'BITCOIN') THEN
            RAISE EXCEPTION 'Unsupported network % for BTC withdrawal. Supported: BTC', p_network;
        END IF;
    ELSIF v_asset_clean = 'ETH' THEN
        IF v_network_clean NOT IN ('ETH', 'ERC20', 'ETHEREUM') THEN
            RAISE EXCEPTION 'Unsupported network % for ETH withdrawal. Supported: ETH/ERC20', p_network;
        END IF;
    ELSIF v_asset_clean = 'LTC' THEN
        IF v_network_clean NOT IN ('LTC', 'LITECOIN') THEN
            RAISE EXCEPTION 'Unsupported network % for LTC withdrawal. Supported: LTC', p_network;
        END IF;
    ELSE
        RAISE EXCEPTION 'Unsupported asset % for withdrawal. Supported: USDT, BTC, ETH, LTC', p_asset;
    END IF;

    -- Normalize network aliases
    IF v_network_clean IN ('TRON') THEN v_network_clean := 'TRC20'; END IF;
    IF v_network_clean IN ('ETHEREUM') THEN v_network_clean := 'ERC20'; END IF;
    IF v_network_clean IN ('BSC', 'BINANCE') THEN v_network_clean := 'BEP20'; END IF;
    IF v_network_clean IN ('BITCOIN') THEN v_network_clean := 'BTC'; END IF;
    IF v_network_clean IN ('LITECOIN') THEN v_network_clean := 'LTC'; END IF;

    -- Fetch Platform Governance Settings
    SELECT 
        COALESCE(max_single_withdrawal_usd, 4000.00),
        COALESCE(withdrawal_approval_threshold_usd, 2000.00),
        COALESCE(daily_withdrawal_limit_usd, 10000.00),
        COALESCE(password_change_withdrawal_hold_hours, 24.00),
        COALESCE(withdrawals_enabled, true),
        COALESCE(global_kill_switch_active, false)
    INTO 
        v_max_single_usd,
        v_approval_threshold_usd,
        v_daily_limit_usd,
        v_pwd_hold_hours,
        v_withdrawals_enabled,
        v_kill_switch
    FROM public.platform_settings
    WHERE id = 1;

    IF v_kill_switch OR NOT v_withdrawals_enabled THEN
        RAISE EXCEPTION 'EMERGENCY_PAUSE: Withdrawals are temporarily disabled for maintenance.';
    END IF;

    -- =========================================================================
    -- CRITICAL STEP 1: EXCLUSIVE USER ROW LOCK (SERIALIZES CONCURRENT WITHDRAWALS)
    -- =========================================================================
    SELECT 
        COALESCE(is_banned, FALSE), 
        COALESCE(is_on_hold, FALSE), 
        COALESCE(is_withdrawal_locked, FALSE),
        account_status,
        kyc_status,
        COALESCE(is_verified, FALSE),
        COALESCE(id_verified, FALSE),
        password_changed_at,
        COALESCE(is_emergency_frozen, FALSE)
    INTO 
        v_is_banned, 
        v_is_on_hold, 
        v_is_withdrawal_locked,
        v_account_status,
        v_kyc_status,
        v_is_verified,
        v_id_verified,
        v_password_changed_at,
        v_is_emergency_frozen
    FROM public.profiles
    WHERE id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'User profile not found for ID %', p_user_id;
    END IF;

    -- =========================================================================
    -- CRITICAL STEP 1.1: AUTHORITATIVE INDIVIDUAL EMERGENCY FREEZE CHECK
    -- =========================================================================
    IF v_is_emergency_frozen THEN
        RAISE EXCEPTION 'USER_EMERGENCY_FROZEN: Your account is currently under an emergency security freeze.'
            USING ERRCODE = 'P0001', DETAIL = 'USER_EMERGENCY_FROZEN';
    END IF;

    -- Check if user account is currently restricted/banned
    IF v_is_banned OR v_is_on_hold OR v_is_withdrawal_locked OR v_account_status IN ('restricted', 'frozen', 'banned') THEN
        RAISE EXCEPTION 'ACCOUNT_RESTRICTED: Account is restricted from initiating withdrawals.';
    END IF;

    -- =========================================================================
    -- CRITICAL STEP 2: PASSWORD CHANGE SECURITY HOLD ENFORCEMENT
    -- =========================================================================
    IF v_password_changed_at IS NOT NULL AND v_password_changed_at > (NOW() - (v_pwd_hold_hours || ' hours')::INTERVAL) THEN
        RAISE EXCEPTION 'PASSWORD_WITHDRAWAL_HOLD: Withdrawals are temporarily suspended following a recent password change for security reasons.';
    END IF;

    -- =========================================================================
    -- CRITICAL STEP 3: ACTIVE PENDING APPROVAL LOCKOUT
    -- =========================================================================
    IF public.has_pending_withdrawal_approval(p_user_id) THEN
        RAISE EXCEPTION 'WITHDRAWAL_APPROVAL_PENDING: Your previous withdrawal is awaiting administrator approval. You cannot create another withdrawal until it is approved or rejected.';
    END IF;

    -- Enforce Strict KYC Identity Verification
    IF NOT (v_is_verified OR v_kyc_status IN ('approved', 'verified') OR v_id_verified) THEN
        RAISE EXCEPTION 'KYC_REQUIRED: Identity verification is required before initiating withdrawals.';
    END IF;

    -- Authoritative USD Equivalent (Server-provided or pegged fallback)
    IF p_usd_equivalent IS NOT NULL AND p_usd_equivalent > 0 THEN
        v_effective_usd := p_usd_equivalent;
    ELSIF v_asset_clean = 'USDT' THEN
        v_effective_usd := p_amount;
    ELSE
        v_effective_usd := p_amount;
    END IF;

    -- =========================================================================
    -- RULE 1: HARD MAXIMUM ENFORCEMENT & AUTOMATIC ACCOUNT RESTRICTION
    -- =========================================================================
    IF v_effective_usd > v_max_single_usd THEN
        UPDATE public.profiles
        SET account_status = 'restricted',
            is_withdrawal_locked = true,
            updated_at = NOW()
        WHERE id = p_user_id;

        INSERT INTO public.admin_audit_logs (
            admin_id,
            admin_email,
            action,
            details,
            created_at
        ) VALUES (
            p_user_id,
            'security_monitor@paxones.com',
            'SECURITY_VIOLATION_HARD_MAX_EXCEEDED',
            jsonb_build_object(
                'user_id', p_user_id,
                'attempted_usd', v_effective_usd,
                'hard_max_usd', v_max_single_usd,
                'asset', v_asset_clean,
                'amount', p_amount,
                'action_taken', 'ACCOUNT_FROZEN_RESTRICTED'
            ),
            NOW()
        );

        RAISE EXCEPTION 'LIMIT_EXCEEDED: Maximum single withdrawal limit ($%) exceeded. Account has been restricted for security review.', v_max_single_usd;
    END IF;

    -- =========================================================================
    -- RULE 2: ROLLING 24-HOUR DAILY LIMIT (CALCULATED UNDER USER ROW LOCK)
    -- =========================================================================
    SELECT COALESCE(SUM(amount), 0)
    INTO v_rolling_24h_usd
    FROM public.withdrawals
    WHERE user_id = p_user_id
      AND created_at >= NOW() - INTERVAL '24 hours'
      AND status IN ('completed', 'processing', 'QUEUED', 'PENDING_APPROVAL', 'APPROVED', 'approved', 'pending');

    IF (v_rolling_24h_usd + v_effective_usd) > v_daily_limit_usd THEN
        UPDATE public.profiles
        SET account_status = 'restricted',
            is_withdrawal_locked = true,
            updated_at = NOW()
        WHERE id = p_user_id;

        INSERT INTO public.admin_audit_logs (
            admin_id,
            admin_email,
            action,
            details,
            created_at
        ) VALUES (
            p_user_id,
            'security_monitor@paxones.com',
            'SECURITY_VIOLATION_DAILY_LIMIT_EXCEEDED',
            jsonb_build_object(
                'user_id', p_user_id,
                'past_24h_usd', v_rolling_24h_usd,
                'attempted_usd', v_effective_usd,
                'daily_limit_usd', v_daily_limit_usd,
                'action_taken', 'ACCOUNT_FROZEN_RESTRICTED'
            ),
            NOW()
        );

        RAISE EXCEPTION 'LIMIT_EXCEEDED: Daily withdrawal limit ($%) exceeded. Account has been restricted for security review.', v_daily_limit_usd;
    END IF;

    -- =========================================================================
    -- RULE 3: APPROVAL THRESHOLD STATE MACHINE
    -- =========================================================================
    IF v_effective_usd >= v_approval_threshold_usd THEN
        v_requires_approval := TRUE;
        v_initial_status := 'PENDING_APPROVAL';
        v_onchain_status := 'PENDING_APPROVAL';
    ELSE
        v_requires_approval := FALSE;
        v_initial_status := 'QUEUED';
        v_onchain_status := 'PENDING';
    END IF;

    v_total_deduct := p_amount + COALESCE(p_fee, 0);

    -- Find or provision wallet identity
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

    -- Lock Authoritative wallet_assets row
    SELECT balance, in_withdrawal
    INTO v_balance, v_in_withdrawal
    FROM public.wallet_assets
    WHERE user_id = p_user_id AND asset_symbol = v_asset_clean
    FOR UPDATE;

    IF v_balance IS NULL OR v_balance < v_total_deduct THEN
        RAISE EXCEPTION 'Insufficient balance. Available: %, Required: % (Amount % + Fee %)',
            COALESCE(v_balance, 0), v_total_deduct, p_amount, COALESCE(p_fee, 0);
    END IF;

    -- Generate Withdrawal UUID
    v_withdrawal_id := gen_random_uuid();

    -- Atomically deduct spendable balance and credit in_withdrawal
    UPDATE public.wallet_assets
    SET balance = balance - v_total_deduct,
        in_withdrawal = in_withdrawal + v_total_deduct,
        updated_at = NOW()
    WHERE user_id = p_user_id AND asset_symbol = v_asset_clean;

    -- Insert into public.withdrawals
    INSERT INTO public.withdrawals (
        id,
        user_id,
        wallet_id,
        asset_symbol,
        asset_code,
        amount,
        network_fee,
        destination_address,
        network,
        network_code,
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
        p_amount,
        COALESCE(p_fee, 0),
        p_to_address,
        v_network_clean,
        v_network_clean,
        v_initial_status,
        'w_' || v_withdrawal_id::TEXT,
        NOW(),
        NOW()
    );

    -- Insert into public.onchain_withdrawals
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
        created_at,
        updated_at
    ) VALUES (
        v_withdrawal_id,
        p_user_id,
        v_wallet_id,
        p_to_address,
        p_amount,
        v_asset_clean,
        v_network_clean,
        v_onchain_status,
        jsonb_build_object(
            'fee', COALESCE(p_fee, 0), 
            'total_deducted', v_total_deduct,
            'usd_equivalent', v_effective_usd,
            'requires_approval', v_requires_approval
        ),
        NOW(),
        NOW()
    );

    -- Record Double-Entry Immutable Ledger Entry
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
        idempotency_key,
        created_at
    ) VALUES (
        v_wallet_id,
        p_user_id,
        v_asset_clean,
        -v_total_deduct,
        +v_total_deduct,
        v_balance - v_total_deduct,
        v_in_withdrawal + v_total_deduct,
        'withdrawal_lock',
        'withdrawals',
        v_withdrawal_id::TEXT,
        'wlock_' || v_withdrawal_id::TEXT,
        NOW()
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    RETURN jsonb_build_object(
        'success', true,
        'withdrawal_id', v_withdrawal_id,
        'status', v_initial_status,
        'requires_approval', v_requires_approval,
        'total_debited', v_total_deduct,
        'message', CASE WHEN v_requires_approval THEN 'Withdrawal awaiting administrator approval' ELSE 'Withdrawal Pending' END
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.request_withdrawal(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_withdrawal(UUID, TEXT, TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC) TO service_role, postgres;

-- ============================================================================
-- 3. CANONICAL execute_internal_transfer WITH INDIVIDUAL EMERGENCY FREEZE
-- ============================================================================
CREATE OR REPLACE FUNCTION public.execute_internal_transfer(
    p_sender_id UUID,
    p_recipient_username TEXT,
    p_asset TEXT,
    p_gross_amount NUMERIC,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_clean_username TEXT := LOWER(TRIM(COALESCE(p_recipient_username, '')));
    v_asset_clean TEXT := UPPER(TRIM(COALESCE(p_asset, '')));
    v_clean_idempotency TEXT := NULLIF(TRIM(COALESCE(p_idempotency_key, '')), '');
    v_recipient_id UUID;
    v_recipient_name TEXT;
    v_sender_name TEXT;
    v_sender_status TEXT;
    v_recipient_status TEXT;
    v_sender_banned BOOLEAN := FALSE;
    v_sender_restricted BOOLEAN := FALSE;
    v_recipient_banned BOOLEAN := FALSE;
    v_recipient_restricted BOOLEAN := FALSE;
    v_sender_frozen BOOLEAN := FALSE;
    v_recipient_frozen BOOLEAN := FALSE;
    
    -- Financial Variables
    v_recipient_amount NUMERIC(36, 18);
    v_fee_amount NUMERIC(36, 18);
    v_total_deduction NUMERIC(36, 18);
    v_fee_rate NUMERIC(10, 6) := 0.015; -- 1.5% platform fee
    
    -- Wallet Asset State Variables
    v_sender_wallet_asset_id UUID;
    v_sender_bal NUMERIC(36, 18);
    v_recipient_wallet_asset_id UUID;
    v_recipient_bal NUMERIC(36, 18);
    v_sender_bal_after NUMERIC(36, 18);
    v_recipient_bal_after NUMERIC(36, 18);
    
    -- Transfer Record Variables
    v_transfer_id UUID;
    v_public_id TEXT;
    v_existing_transfer RECORD;
BEGIN
    -- 1. Input Validation
    IF p_sender_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sender ID is required');
    END IF;

    -- Security check: Enforce caller identity unless executing under service_role
    IF auth.role() <> 'service_role' AND auth.uid() IS NOT NULL AND auth.uid() <> p_sender_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthorized: Sender identity mismatch');
    END IF;

    IF v_clean_username = '' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Recipient username is required');
    END IF;

    IF p_gross_amount IS NULL OR p_gross_amount <= 0 THEN
        RETURN jsonb_build_object('success', false, 'error', 'Transfer amount must be strictly greater than zero');
    END IF;

    -- Supported Asset Validation (Strictly USDT, BTC, ETH, LTC)
    IF v_asset_clean NOT IN ('USDT', 'BTC', 'ETH', 'LTC') THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Unsupported asset for transfer: ' || v_asset_clean || '. Supported: USDT, BTC, ETH, LTC'
        );
    END IF;

    -- Preliminary lookup to resolve recipient UUID for deterministic lock ordering
    SELECT id INTO v_recipient_id
    FROM public.profiles
    WHERE LOWER(username) = v_clean_username
       OR LOWER(email) = v_clean_username
       OR id::TEXT = v_clean_username
    LIMIT 1;

    -- Fallback: Check deposit addresses for recipient user resolution
    IF v_recipient_id IS NULL THEN
        SELECT uda.user_id INTO v_recipient_id
        FROM public.user_deposit_addresses uda
        WHERE uda.address = p_recipient_username
        LIMIT 1;
    END IF;

    IF v_recipient_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Recipient user @' || p_recipient_username || ' not found on the platform');
    END IF;

    IF v_recipient_id = p_sender_id THEN
        RETURN jsonb_build_object('success', false, 'error', 'You cannot transfer funds to yourself');
    END IF;

    -- =========================================================================
    -- DETERMINISTIC ROW LOCKING: Lock profiles in consistent UUID order (smaller first)
    -- =========================================================================
    IF p_sender_id < v_recipient_id THEN
        SELECT username, COALESCE(is_banned, FALSE), COALESCE(is_restricted, FALSE), LOWER(COALESCE(account_status, 'active')), COALESCE(is_emergency_frozen, FALSE)
        INTO v_sender_name, v_sender_banned, v_sender_restricted, v_sender_status, v_sender_frozen
        FROM public.profiles WHERE id = p_sender_id FOR UPDATE;

        SELECT username, COALESCE(is_banned, FALSE), COALESCE(is_restricted, FALSE), LOWER(COALESCE(account_status, 'active')), COALESCE(is_emergency_frozen, FALSE)
        INTO v_recipient_name, v_recipient_banned, v_recipient_restricted, v_recipient_status, v_recipient_frozen
        FROM public.profiles WHERE id = v_recipient_id FOR UPDATE;
    ELSE
        SELECT username, COALESCE(is_banned, FALSE), COALESCE(is_restricted, FALSE), LOWER(COALESCE(account_status, 'active')), COALESCE(is_emergency_frozen, FALSE)
        INTO v_recipient_name, v_recipient_banned, v_recipient_restricted, v_recipient_status, v_recipient_frozen
        FROM public.profiles WHERE id = v_recipient_id FOR UPDATE;

        SELECT username, COALESCE(is_banned, FALSE), COALESCE(is_restricted, FALSE), LOWER(COALESCE(account_status, 'active')), COALESCE(is_emergency_frozen, FALSE)
        INTO v_sender_name, v_sender_banned, v_sender_restricted, v_sender_status, v_sender_frozen
        FROM public.profiles WHERE id = p_sender_id FOR UPDATE;
    END IF;

    IF v_sender_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sender profile not found');
    END IF;

    -- =========================================================================
    -- INDIVIDUAL EMERGENCY FREEZE VALIDATION (Sender & Recipient)
    -- =========================================================================
    IF v_sender_frozen THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Your account is under an emergency security freeze.',
            'code', 'USER_EMERGENCY_FROZEN'
        );
    END IF;

    IF v_sender_banned OR v_sender_restricted OR v_sender_status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Your account is restricted or non-active. Transfers are blocked.');
    END IF;

    IF v_recipient_name IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Recipient profile not found');
    END IF;

    IF v_recipient_frozen THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Cannot transfer: Recipient account is under an emergency security freeze.',
            'code', 'USER_EMERGENCY_FROZEN'
        );
    END IF;

    IF v_recipient_banned OR v_recipient_restricted OR v_recipient_status <> 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Cannot transfer: Recipient account is restricted or non-active on the platform.');
    END IF;

    -- 4. Full Multi-Parameter Idempotency Validation with Advisory Lock
    IF v_clean_idempotency IS NOT NULL THEN
        PERFORM pg_advisory_xact_lock(hashtext('trf:' || p_sender_id::TEXT || ':' || v_clean_idempotency));

        SELECT * INTO v_existing_transfer
        FROM public.transfers
        WHERE sender_id = p_sender_id AND idempotency_key = v_clean_idempotency
        LIMIT 1;

        IF v_existing_transfer.id IS NOT NULL THEN
            IF v_existing_transfer.recipient_id <> v_recipient_id
               OR UPPER(COALESCE(v_existing_transfer.crypto, v_existing_transfer.asset_symbol, '')) <> v_asset_clean
               OR v_existing_transfer.amount <> p_gross_amount THEN
                RETURN jsonb_build_object(
                    'success', false,
                    'error', 'Idempotency conflict: A transfer with this idempotency key was already submitted with different parameters (recipient, asset, or amount)'
                );
            END IF;

            RETURN jsonb_build_object(
                'success', true,
                'idempotent_replay', true,
                'transfer_id', v_existing_transfer.id,
                'public_id', COALESCE(v_existing_transfer.public_id, v_existing_transfer.transfer_id, v_existing_transfer.id::TEXT),
                'sender_id', v_existing_transfer.sender_id,
                'recipient_id', v_existing_transfer.recipient_id,
                'recipient', COALESCE(v_existing_transfer.recipient_username, v_recipient_name),
                'recipient_username', COALESCE(v_existing_transfer.recipient_username, v_recipient_name),
                'sender_username', COALESCE(v_existing_transfer.sender_username, v_sender_name),
                'asset', v_asset_clean,
                'amount', v_existing_transfer.amount,
                'gross_amount', v_existing_transfer.amount,
                'net_amount', v_existing_transfer.amount,
                'fee', COALESCE(v_existing_transfer.fee_amount, v_existing_transfer.fee, 0),
                'fee_amount', COALESCE(v_existing_transfer.fee_amount, v_existing_transfer.fee, 0),
                'total_deduction', v_existing_transfer.amount + COALESCE(v_existing_transfer.fee_amount, v_existing_transfer.fee, 0),
                'status', COALESCE(v_existing_transfer.status::TEXT, 'confirmed'),
                'message', 'Transfer already processed successfully (idempotent replay)'
            );
        END IF;
    END IF;

    -- 5. Calculate Exact 1.5% Fee & Financial Deductions
    v_recipient_amount := p_gross_amount;
    v_fee_amount := ROUND((v_recipient_amount * v_fee_rate)::numeric, 8);
    v_total_deduction := v_recipient_amount + v_fee_amount;

    -- 6. Ensure Recipient wallet_assets record exists
    INSERT INTO public.wallet_assets (
        user_id,
        asset_symbol,
        balance,
        locked_balance,
        reserved_balance,
        in_escrow,
        in_withdrawal,
        created_at,
        updated_at
    )
    VALUES (
        v_recipient_id,
        v_asset_clean,
        0,
        0,
        0,
        0,
        0,
        NOW(),
        NOW()
    )
    ON CONFLICT (user_id, asset_symbol) DO NOTHING;

    -- 7. Deterministic Deadlock-Safe Row Locking on wallet_assets
    IF p_sender_id < v_recipient_id THEN
        SELECT id, balance INTO v_sender_wallet_asset_id, v_sender_bal
        FROM public.wallet_assets
        WHERE user_id = p_sender_id AND asset_symbol = v_asset_clean
        FOR UPDATE;

        SELECT id, balance INTO v_recipient_wallet_asset_id, v_recipient_bal
        FROM public.wallet_assets
        WHERE user_id = v_recipient_id AND asset_symbol = v_asset_clean
        FOR UPDATE;
    ELSE
        SELECT id, balance INTO v_recipient_wallet_asset_id, v_recipient_bal
        FROM public.wallet_assets
        WHERE user_id = v_recipient_id AND asset_symbol = v_asset_clean
        FOR UPDATE;

        SELECT id, balance INTO v_sender_wallet_asset_id, v_sender_bal
        FROM public.wallet_assets
        WHERE user_id = p_sender_id AND asset_symbol = v_asset_clean
        FOR UPDATE;
    END IF;

    IF v_sender_wallet_asset_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Sender ' || v_asset_clean || ' wallet asset record not found');
    END IF;

    IF v_recipient_wallet_asset_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Recipient ' || v_asset_clean || ' wallet asset record not found');
    END IF;

    -- 8. Spendable Balance Validation
    IF v_sender_bal IS NULL OR v_sender_bal < v_total_deduction THEN
        RETURN jsonb_build_object(
            'success', false,
            'error', 'Insufficient spendable ' || v_asset_clean || ' balance. Required: ' || v_total_deduction::TEXT || ' ' || v_asset_clean || ' (Recipient Amount: ' || v_recipient_amount::TEXT || ' + 1.5% Fee: ' || v_fee_amount::TEXT || '), Available: ' || COALESCE(v_sender_bal, 0)::TEXT || ' ' || v_asset_clean
        );
    END IF;

    -- 9. Atomic Financial Balance Mutations on wallet_assets
    v_sender_bal_after := v_sender_bal - v_total_deduction;
    UPDATE public.wallet_assets
    SET balance = v_sender_bal_after,
        updated_at = NOW()
    WHERE id = v_sender_wallet_asset_id;

    v_recipient_bal_after := v_recipient_bal + v_recipient_amount;
    UPDATE public.wallet_assets
    SET balance = v_recipient_bal_after,
        updated_at = NOW()
    WHERE id = v_recipient_wallet_asset_id;

    -- 10. Generate Transfer IDs
    v_transfer_id := gen_random_uuid();
    v_public_id := 'TRF' || UPPER(SUBSTRING(REPLACE(v_transfer_id::TEXT, '-', ''), 1, 9));

    -- 11. Record Transfer in public.transfers
    INSERT INTO public.transfers (
        id,
        public_id,
        sender_id,
        recipient_id,
        amount,
        crypto,
        fee_amount,
        fee,
        status,
        transfer_id,
        sender_username,
        recipient_username,
        asset_symbol,
        idempotency_key,
        created_at
    )
    VALUES (
        v_transfer_id,
        v_public_id,
        p_sender_id,
        v_recipient_id,
        v_recipient_amount,
        v_asset_clean,
        v_fee_amount,
        v_fee_amount,
        'confirmed',
        v_public_id,
        v_sender_name,
        v_recipient_name,
        v_asset_clean,
        v_clean_idempotency,
        NOW()
    );

    -- 12. Record Double-Entry in public.ledger_entries
    INSERT INTO public.ledger_entries (
        user_id,
        crypto,
        asset,
        chain,
        amount,
        type,
        status,
        reference_id,
        balance_after,
        metadata,
        created_at
    )
    VALUES (
        p_sender_id,
        v_asset_clean,
        v_asset_clean,
        'INTERNAL',
        -v_total_deduction,
        'transfer',
        'completed',
        v_transfer_id::TEXT,
        v_sender_bal_after,
        jsonb_build_object(
            'transfer_id', v_transfer_id,
            'public_id', v_public_id,
            'recipient_id', v_recipient_id,
            'recipient_username', v_recipient_name,
            'recipient_amount', v_recipient_amount,
            'fee_amount', v_fee_amount,
            'fee_rate', v_fee_rate,
            'total_deduction', v_total_deduction,
            'direction', 'SENT',
            'idempotency_key', v_clean_idempotency
        ),
        NOW()
    );

    INSERT INTO public.ledger_entries (
        user_id,
        crypto,
        asset,
        chain,
        amount,
        type,
        status,
        reference_id,
        balance_after,
        metadata,
        created_at
    )
    VALUES (
        v_recipient_id,
        v_asset_clean,
        v_asset_clean,
        'INTERNAL',
        v_recipient_amount,
        'transfer',
        'completed',
        v_transfer_id::TEXT,
        v_recipient_bal_after,
        jsonb_build_object(
            'transfer_id', v_transfer_id,
            'public_id', v_public_id,
            'sender_id', p_sender_id,
            'sender_username', v_sender_name,
            'received_amount', v_recipient_amount,
            'direction', 'RECEIVED',
            'idempotency_key', v_clean_idempotency
        ),
        NOW()
    );

    -- 13. Record Platform Revenue in public.platform_ledger_entries
    IF v_fee_amount > 0 THEN
        INSERT INTO public.platform_ledger_entries (
            entry_type,
            asset_code,
            amount,
            direction,
            related_user_id,
            ref_table,
            ref_id,
            network_code,
            idempotency_key,
            metadata,
            created_at
        )
        VALUES (
            'transfer_fee_collected',
            v_asset_clean,
            v_fee_amount,
            'CREDIT',
            p_sender_id,
            'transfers',
            v_transfer_id::TEXT,
            'INTERNAL',
            'fee_transfer_' || v_transfer_id::TEXT,
            jsonb_build_object(
                'transfer_id', v_transfer_id,
                'public_id', v_public_id,
                'sender_id', p_sender_id,
                'recipient_id', v_recipient_id,
                'recipient_amount', v_recipient_amount,
                'fee_amount', v_fee_amount,
                'fee_rate', v_fee_rate,
                'total_deduction', v_total_deduction,
                'asset', v_asset_clean,
                'original_idempotency_key', v_clean_idempotency
            ),
            NOW()
        );
    END IF;

    -- 14. Create In-App Notification for Recipient
    BEGIN
        INSERT INTO public.notifications (
            user_id,
            type,
            title,
            message,
            metadata,
            is_read,
            created_at
        )
        VALUES (
            v_recipient_id,
            'transfer',
            'Transfer Received',
            'You received ' || v_recipient_amount::TEXT || ' ' || v_asset_clean || ' from @' || v_sender_name,
            jsonb_build_object(
                'sender_id', p_sender_id,
                'sender_username', v_sender_name,
                'amount', v_recipient_amount,
                'asset', v_asset_clean,
                'transfer_id', v_transfer_id,
                'public_id', v_public_id,
                'link', '/wallet'
            ),
            false,
            NOW()
        );
    EXCEPTION WHEN OTHERS THEN
        NULL;
    END;

    -- 15. Return Comprehensive Result Payload
    RETURN jsonb_build_object(
        'success', true,
        'transfer_id', v_transfer_id,
        'public_id', v_public_id,
        'sender_id', p_sender_id,
        'recipient_id', v_recipient_id,
        'recipient', v_recipient_name,
        'recipient_username', v_recipient_name,
        'sender_username', v_sender_name,
        'asset', v_asset_clean,
        'amount', v_recipient_amount,
        'gross_amount', v_recipient_amount,
        'net_amount', v_recipient_amount,
        'fee', v_fee_amount,
        'fee_amount', v_fee_amount,
        'total_deduction', v_total_deduction,
        'sender_balance_after', v_sender_bal_after,
        'recipient_balance_after', v_recipient_bal_after,
        'status', 'confirmed',
        'idempotent_replay', false
    );
END;
$$;

REVOKE ALL ON FUNCTION public.execute_internal_transfer(UUID, TEXT, TEXT, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.execute_internal_transfer(UUID, TEXT, TEXT, NUMERIC, TEXT) TO service_role, postgres;

COMMIT;
