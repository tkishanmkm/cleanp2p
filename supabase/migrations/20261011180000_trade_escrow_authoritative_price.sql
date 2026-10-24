-- Production hardening: seller escrow must use server-stored ad pricing.
-- The trade RPC previously preferred caller-supplied p_price, allowing a buyer to
-- create a trade at a different price than the published advertisement.
BEGIN;

-- Durable idempotency records for atomic P2P trade creation.
CREATE TABLE IF NOT EXISTS public.trade_request_idempotency (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL CHECK (char_length(idempotency_key) BETWEEN 8 AND 128),
    request_fingerprint TEXT NOT NULL,
    trade_id UUID REFERENCES public.trades(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, idempotency_key)
);
ALTER TABLE public.trade_request_idempotency ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.trade_request_idempotency FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.trade_request_idempotency TO service_role, postgres;



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
    v_ad_price NUMERIC(36, 18) := 0.0;
    v_ad_margin_percent NUMERIC(10, 6) := 0.0;
    v_market_price NUMERIC(36, 18) := NULL;
    v_ad_is_fixed BOOLEAN := FALSE;
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
    v_existing_request RECORD;
    v_request_fingerprint TEXT;

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
        LIMIT 1
        FOR UPDATE;
    ELSE
        SELECT * INTO v_p2p_ad
        FROM public.p2p_ads
        WHERE public_ad_id = p_ad_id
           OR id::TEXT = p_ad_id
        LIMIT 1
        FOR UPDATE;
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

        v_ad_price := COALESCE(NULLIF(v_p2p_ad.price, 0), 0);
        v_ad_margin_percent := COALESCE(NULLIF(to_jsonb(v_p2p_ad)->>'rate_percent', '')::NUMERIC, NULLIF(to_jsonb(v_p2p_ad)->>'margin', '')::NUMERIC, 0);
        v_ad_is_fixed := COALESCE(NULLIF(to_jsonb(v_p2p_ad)->>'is_fixed', '')::BOOLEAN, FALSE) OR UPPER(COALESCE(to_jsonb(v_p2p_ad)->>'pricing_type', '')) = 'FIXED';

        v_ad_fiat_currency := UPPER(COALESCE(NULLIF(v_p2p_ad.fiat_currency, ''), NULLIF(v_p2p_ad.fiat_symbol, ''), 'USD'));

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
        LIMIT 1
        FOR UPDATE;

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

            v_ad_price := COALESCE(NULLIF(v_legacy_ad.price, 0), NULLIF(v_legacy_ad.unit_price, 0), NULLIF(v_legacy_ad.fixed_rate, 0), 0);
            v_ad_margin_percent := COALESCE(NULLIF(to_jsonb(v_legacy_ad)->>'rate_percent', '')::NUMERIC, NULLIF(to_jsonb(v_legacy_ad)->>'margin', '')::NUMERIC, 0);
            v_ad_is_fixed := COALESCE(NULLIF(to_jsonb(v_legacy_ad)->>'is_fixed', '')::BOOLEAN, FALSE) OR UPPER(COALESCE(to_jsonb(v_legacy_ad)->>'pricing_type', '')) = 'FIXED';

            v_ad_fiat_currency := UPPER(COALESCE(NULLIF(v_legacy_ad.fiat_currency, ''), NULLIF(v_legacy_ad.fiat_symbol, ''), NULLIF(v_legacy_ad.currency, ''), 'USD'));

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
    -- Resolve FLOAT ads from canonical market data and the stored margin.
    IF NOT v_ad_is_fixed THEN
        IF v_ad_margin_percent::TEXT IN ('NaN', 'Infinity', '-Infinity') OR v_ad_margin_percent < -50 OR v_ad_margin_percent > 50 THEN
            RAISE EXCEPTION 'Advertisement margin is invalid; trade creation is blocked.';
        END IF;
        SELECT price_in_fiat INTO v_market_price
        FROM public.crypto_market_prices
        WHERE UPPER(asset_symbol) = v_ad_asset
          AND UPPER(fiat_symbol) = v_ad_fiat_currency
          AND price_in_fiat > 0
          AND price_in_fiat::TEXT NOT IN ('NaN', 'Infinity', '-Infinity')
        ORDER BY updated_at DESC
        LIMIT 1;
        IF v_market_price IS NULL THEN
            RAISE EXCEPTION 'Current market price is unavailable for %/%; trade creation is blocked.', v_ad_asset, v_ad_fiat_currency;
        END IF;
        v_ad_price := ROUND(v_market_price * (1 + v_ad_margin_percent / 100), 8);
    END IF;
    IF v_ad_price <= 0 OR v_ad_price::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION 'Advertisement has no valid server-side price; trade creation is blocked.';
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

    IF p_crypto_amount IS NOT NULL AND p_crypto_amount::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION 'Invalid non-finite crypto amount.';
    END IF;
    v_crypto_amount := ROUND(COALESCE(p_crypto_amount, 0), 8);
    IF v_crypto_amount <= 0 AND p_fiat_amount > 0 AND p_fiat_amount::TEXT NOT IN ('NaN', 'Infinity', '-Infinity') THEN
        v_crypto_amount := ROUND((p_fiat_amount / v_unit_price), 8);
    END IF;

    IF v_crypto_amount <= 0 OR v_crypto_amount::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION 'Invalid crypto amount: %', p_crypto_amount;
    END IF;

    v_fiat_amount := ROUND((v_crypto_amount * v_unit_price), 2);
    v_escrow_fee := ROUND(v_crypto_amount * 0.015, 8);
    v_total_escrow := v_crypto_amount + v_escrow_fee;

    v_public_id := COALESCE(p_trade_ref, 'TX' || SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 8));

    -- 7. Durable idempotency: serialize same-user retries and bind each key to request data.
    IF p_idempotency_key IS NULL OR LENGTH(BTRIM(p_idempotency_key)) < 8 OR LENGTH(BTRIM(p_idempotency_key)) > 128 THEN
        RAISE EXCEPTION 'A valid idempotency key between 8 and 128 characters is required.';
    END IF;
    v_request_fingerprint := MD5(CONCAT_WS('|',
        COALESCE(v_ad_id::TEXT, v_ad_public_ad_id, v_trade_ad_id, p_ad_id),
        v_ad_asset, v_crypto_amount::TEXT, v_fiat_currency, v_unit_price::TEXT,
        LOWER(BTRIM(COALESCE(p_payment_method, 'Bank Transfer')))
    ));
    PERFORM pg_advisory_xact_lock(HASHtextextended(v_effective_caller::TEXT || ':' || BTRIM(p_idempotency_key), 0));
    SELECT * INTO v_existing_request
    FROM public.trade_request_idempotency
    WHERE user_id = v_effective_caller AND idempotency_key = BTRIM(p_idempotency_key)
    FOR UPDATE;
    IF FOUND THEN
        IF v_existing_request.request_fingerprint IS DISTINCT FROM v_request_fingerprint THEN
            RAISE EXCEPTION 'Idempotency key was already used for a different trade request.';
        END IF;
        IF v_existing_request.trade_id IS NULL THEN
            RAISE EXCEPTION 'Prior trade request requires reconciliation; duplicate creation is blocked.';
        END IF;
        SELECT * INTO v_existing_trade FROM public.trades WHERE id = v_existing_request.trade_id;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Prior trade record is missing; duplicate creation is blocked.';
        END IF;
        RETURN jsonb_build_object(
            'success', true, 'trade_id', v_existing_trade.id, 'public_id', v_existing_trade.public_id,
            'buyer_id', v_existing_trade.buyer_id, 'seller_id', v_existing_trade.seller_id,
            'crypto_amount', v_existing_trade.crypto_amount, 'escrow_fee', v_existing_trade.escrow_fee,
            'fiat_amount', v_existing_trade.fiat_amount, 'price', v_existing_trade.price,
            'fiat_currency', v_existing_trade.fiat_currency, 'asset', v_existing_trade.crypto,
            'status', v_existing_trade.status, 'escrow_status', v_existing_trade.escrow_status,
            'message', 'Trade already initiated (idempotent replay)'
        );
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

    INSERT INTO public.trade_request_idempotency (user_id, idempotency_key, request_fingerprint, trade_id)
    VALUES (v_effective_caller, BTRIM(p_idempotency_key), v_request_fingerprint, v_trade_id);

    RETURN jsonb_build_object(
        'success', true,
        'trade_id', v_trade_id,
        'public_id', v_public_id,
        'buyer_id', v_buyer_id,
        'seller_id', v_seller_id,
        'crypto_amount', v_crypto_amount,
        'escrow_fee', v_escrow_fee,
        'fiat_amount', v_fiat_amount,
        'price', v_unit_price,
        'fiat_currency', v_fiat_currency,
        'asset', v_ad_asset,
        'status', 'pending',
        'escrow_status', 'ESCROW_LOCKED',
        'expires_at', (NOW() + (v_ad_payment_window_mins || ' minutes')::INTERVAL)
    );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID) TO authenticated, service_role, postgres;

COMMIT;
