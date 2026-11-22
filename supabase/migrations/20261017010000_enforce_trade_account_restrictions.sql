-- Database-level account restriction enforcement for the canonical SECURITY DEFINER escrow RPC.
BEGIN;

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

    -- Strongly-typed record variable for canonical public.ads relation
    v_ad public.ads%ROWTYPE;

    -- Normalized scalar variables (v_ad_id updated to TEXT to support 12-char alphanumeric IDs)
    v_found_ad BOOLEAN := FALSE;
    v_ad_id TEXT := NULL;
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
    v_trade_usd_amount NUMERIC(18, 2) := 0;
    v_market_usd_price NUMERIC(36, 18) := NULL;

    -- Identifiers & Wallets
    v_trade_id UUID;
    v_public_id TEXT;
    v_clean_idempotency TEXT := NULL;
    v_request_fingerprint TEXT := NULL;
    v_candidate_fingerprint TEXT := NULL;
    v_diag_constraint TEXT := NULL;
    v_trade_ad_id VARCHAR := NULL;
    v_ad_public_ad_id TEXT := NULL;
    v_seller_wallet_asset_id UUID;
    v_seller_bal NUMERIC(36, 18);
    v_seller_escrow NUMERIC(36, 18);
    v_seller_bal_after NUMERIC(36, 18);
    v_seller_escrow_after NUMERIC(36, 18);
    v_existing_trade RECORD;

    -- Global Emergency Control Variables
    v_emergency_mode_val JSONB := NULL;
    v_prevent_new_trades_val JSONB := NULL;
    v_maintenance_mode_val JSONB := NULL;
    v_emergency_mode BOOLEAN := NULL;
    v_prevent_new_trades BOOLEAN := NULL;
    v_maintenance_mode BOOLEAN := NULL;
    v_setting_rec RECORD;
    v_read_count INTEGER := 0;
    v_is_caller_admin BOOLEAN := FALSE;

    -- Individual Emergency Freeze Variables
    v_caller_frozen BOOLEAN := FALSE;
    v_counterparty_frozen BOOLEAN := FALSE;
    v_caller_banned BOOLEAN := FALSE;
    v_caller_restricted BOOLEAN := FALSE;
    v_caller_on_hold BOOLEAN := FALSE;
    v_caller_suspended BOOLEAN := FALSE;
    v_caller_minor_restricted BOOLEAN := FALSE;
    v_caller_account_status TEXT := '';
    v_counterparty_banned BOOLEAN := FALSE;
    v_counterparty_restricted BOOLEAN := FALSE;
    v_counterparty_on_hold BOOLEAN := FALSE;
    v_counterparty_suspended BOOLEAN := FALSE;
    v_counterparty_minor_restricted BOOLEAN := FALSE;
    v_counterparty_account_status TEXT := '';

    -- KYC Tier Variables
    v_seller_tier INTEGER := 1;
    v_buyer_tier INTEGER := 1;
    v_buyer_cum_buys NUMERIC := 0;
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

    -- 1.0 Enforce caller account restrictions before idempotent replay and new trades.
    SELECT COALESCE(is_banned, FALSE), COALESCE(is_restricted, FALSE),
           COALESCE(is_on_hold, FALSE), COALESCE(is_suspended, FALSE),
           COALESCE(is_minor_restricted, FALSE),
           LOWER(COALESCE(account_status::TEXT, ''))
    INTO v_caller_banned, v_caller_restricted, v_caller_on_hold,
         v_caller_suspended, v_caller_minor_restricted, v_caller_account_status
    FROM public.profiles WHERE id = v_effective_caller;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Account profile is unavailable. Trade creation rejected.'
            USING ERRCODE = 'P0001', DETAIL = 'ACCOUNT_PROFILE_UNAVAILABLE';
    END IF;
    IF v_caller_banned OR v_caller_restricted OR v_caller_on_hold OR v_caller_suspended
       OR v_caller_minor_restricted OR v_caller_account_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'Your account is restricted or non-active. New trade initiation is blocked.'
            USING ERRCODE = 'P0001', DETAIL = 'ACCOUNT_RESTRICTED';
    END IF;
    -- 1.1 Strict Idempotency Key Validation
    v_clean_idempotency := NULLIF(TRIM(COALESCE(p_idempotency_key, '')), '');
    IF v_clean_idempotency IS NULL THEN
        RAISE EXCEPTION 'Idempotency key is required for trade initiation.'
            USING ERRCODE = 'P0001', DETAIL = 'IDEMPOTENCY_KEY_REQUIRED';
    END IF;

    -- 1.2 Acquire Advisory Lock for Idempotency Key (Transaction-scoped)
    PERFORM pg_advisory_xact_lock(
        hashtextextended(
            'p2p_trade_idempotency:' || v_clean_idempotency,
            0
        )
    );

    -- 1.3 Early Idempotency Lookup & Replay
    -- (Executes BEFORE advertisement resolution so valid retries succeed even if the ad was deleted or paused)
    SELECT * INTO v_existing_trade
    FROM public.trades
    WHERE idempotency_key = v_clean_idempotency
    LIMIT 1;

    IF v_existing_trade.id IS NOT NULL THEN
        -- 1.3.1 Participant authorization check: ensure caller is an authorized participant in the trade
        IF v_existing_trade.buyer_id <> v_effective_caller::TEXT
           AND v_existing_trade.seller_id <> v_effective_caller::TEXT
           AND auth.role() <> 'service_role' THEN
            RAISE EXCEPTION 'Unauthorized: Idempotency key collision or caller is not a participant in this trade.'
                USING ERRCODE = 'P0001', DETAIL = 'IDEMPOTENCY_COLLISION_UNAUTHORIZED';
        END IF;

        -- 1.3.2 Strict Request Replay Validation: Verify all required material inputs are present in current request
        IF p_ad_id IS NULL OR TRIM(p_ad_id) = '' THEN
            RAISE EXCEPTION 'Idempotency request incomplete: Advertisement identifier (ad_id) is required for trade replay verification.'
                USING ERRCODE = 'P0001', DETAIL = 'IDEMPOTENCY_REQUEST_INCOMPLETE';
        END IF;

        IF p_fiat_currency IS NULL OR TRIM(p_fiat_currency) = '' THEN
            RAISE EXCEPTION 'Idempotency request incomplete: Fiat currency is required for trade replay verification.'
                USING ERRCODE = 'P0001', DETAIL = 'IDEMPOTENCY_REQUEST_INCOMPLETE';
        END IF;
        v_fiat_currency := UPPER(TRIM(p_fiat_currency));

        IF p_payment_method IS NULL THEN
            RAISE EXCEPTION 'Idempotency request incomplete: Payment method is required for trade replay verification.'
                USING ERRCODE = 'P0001', DETAIL = 'IDEMPOTENCY_REQUEST_INCOMPLETE';
        END IF;

        IF p_price IS NULL OR p_price <= 0 THEN
            RAISE EXCEPTION 'Idempotency request incomplete: Price is required and must be strictly positive for trade replay verification.'
                USING ERRCODE = 'P0001', DETAIL = 'IDEMPOTENCY_REQUEST_INCOMPLETE';
        END IF;
        v_unit_price := p_price;

        IF (p_crypto_amount IS NULL OR p_crypto_amount <= 0) AND (p_fiat_amount IS NULL OR p_fiat_amount <= 0) THEN
            RAISE EXCEPTION 'Idempotency request incomplete: Valid crypto_amount or fiat_amount is required for trade replay verification.'
                USING ERRCODE = 'P0001', DETAIL = 'IDEMPOTENCY_REQUEST_INCOMPLETE';
        END IF;

        IF p_crypto_amount IS NOT NULL AND p_crypto_amount > 0 THEN
            v_crypto_amount := ROUND(p_crypto_amount, 8);
        ELSE
            v_crypto_amount := ROUND((p_fiat_amount / v_unit_price), 8);
        END IF;

        -- Mathematical consistency validation: If both are supplied, verify they match
        IF p_crypto_amount IS NOT NULL AND p_crypto_amount > 0 AND p_fiat_amount IS NOT NULL AND p_fiat_amount > 0 THEN
            IF ROUND(p_fiat_amount, 2) IS DISTINCT FROM ROUND((v_crypto_amount * v_unit_price), 2) THEN
                RAISE EXCEPTION 'Idempotency key reuse conflict: Provided fiat_amount (%) does not match crypto_amount * price (%).',
                    ROUND(p_fiat_amount, 2), ROUND((v_crypto_amount * v_unit_price), 2)
                    USING ERRCODE = 'P0001', DETAIL = 'IDEMPOTENCY_KEY_REUSE_CONFLICT';
            END IF;
        END IF;

        v_fiat_amount := ROUND((v_crypto_amount * v_unit_price), 2);

        -- 1.3.3 Advertisement Match Check
        IF v_existing_trade.ad_id IS DISTINCT FROM TRIM(p_ad_id) AND v_existing_trade.public_ad_id IS DISTINCT FROM TRIM(p_ad_id) THEN
            RAISE EXCEPTION 'Idempotency key reuse conflict: Key % was previously used for advertisement %.', v_clean_idempotency, v_existing_trade.ad_id
                USING ERRCODE = 'P0001', DETAIL = 'IDEMPOTENCY_KEY_REUSE_CONFLICT';
        END IF;

        -- 1.3.4 Candidate Fingerprint Calculation (Computed strictly from current request parameters)
        v_candidate_fingerprint := encode(
            sha256(
                (v_existing_trade.buyer_id || ':' ||
                 v_existing_trade.seller_id || ':' ||
                 v_existing_trade.ad_id || ':' ||
                 UPPER(COALESCE(v_existing_trade.crypto, v_existing_trade.asset_code, 'USDT')) || ':' ||
                 v_crypto_amount::TEXT || ':' ||
                 v_fiat_amount::TEXT || ':' ||
                 v_fiat_currency || ':' ||
                 LOWER(TRIM(p_payment_method)) || ':' ||
                 v_unit_price::TEXT)::bytea
            ),
            'hex'
        );

        IF v_existing_trade.request_fingerprint IS NOT NULL THEN
            IF v_existing_trade.request_fingerprint IS DISTINCT FROM v_candidate_fingerprint THEN
                RAISE EXCEPTION 'Idempotency key reuse conflict: Key % was previously used for a trade with different parameters.', v_clean_idempotency
                    USING ERRCODE = 'P0001', DETAIL = 'IDEMPOTENCY_KEY_REUSE_CONFLICT';
            END IF;
        END IF;

        -- 1.3.5 Material Parameter Consistency Check
        IF v_existing_trade.crypto_amount IS DISTINCT FROM v_crypto_amount
           OR v_existing_trade.fiat_amount IS DISTINCT FROM v_fiat_amount
           OR UPPER(v_existing_trade.fiat_currency) IS DISTINCT FROM v_fiat_currency
           OR LOWER(COALESCE(v_existing_trade.payment_method, '')) IS DISTINCT FROM LOWER(TRIM(p_payment_method))
           OR (v_existing_trade.price IS DISTINCT FROM v_unit_price AND v_existing_trade.unit_price IS DISTINCT FROM v_unit_price) THEN
            RAISE EXCEPTION 'Idempotency key reuse conflict: Key % was previously used for a trade with different parameters.', v_clean_idempotency
                USING ERRCODE = 'P0001', DETAIL = 'IDEMPOTENCY_KEY_REUSE_CONFLICT';
        END IF;

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

    -- =========================================================================
    -- 2. RESOLVE TARGET ADVERTISEMENT FROM CANONICAL public.ads (TEXT / NANOID)
    -- =========================================================================
    SELECT * INTO v_ad
    FROM public.ads
    WHERE id = TRIM(p_ad_id)
       OR public_id = TRIM(p_ad_id)
       OR public_ad_id = TRIM(p_ad_id)
    LIMIT 1;

    IF v_ad.id IS NOT NULL THEN
        v_found_ad := TRUE;
        v_ad_id := v_ad.id;
        v_trade_ad_id := v_ad.id::VARCHAR;
        v_ad_public_ad_id := COALESCE(v_ad.public_ad_id, v_ad.public_id, v_ad.id::TEXT);
        v_ad_user_id := v_ad.user_id;
        v_ad_type := UPPER(COALESCE(v_ad.type, 'SELL'));
        v_ad_asset := UPPER(COALESCE(v_ad.asset_symbol, v_ad.asset, v_ad.coin, 'USDT'));
        v_ad_price := COALESCE(v_ad.price, v_ad.unit_price, 1.0);
        v_ad_fiat_currency := UPPER(COALESCE(v_ad.fiat_symbol, v_ad.fiat_currency, 'USD'));
        v_ad_payment_window_mins := COALESCE(v_ad.payment_window_minutes, v_ad.payment_window, 30);
        v_ad_is_active := (UPPER(TRIM(COALESCE(v_ad.status, ''))) = 'ACTIVE')
                      AND COALESCE(v_ad.is_active, TRUE)
                      AND COALESCE(v_ad.active, TRUE)
                      AND NOT COALESCE(v_ad.is_deleted, FALSE);
        v_ad_source := 'ads';
    END IF;

    IF NOT v_found_ad THEN
        RAISE EXCEPTION 'Advertisement not found for identifier %', p_ad_id
            USING ERRCODE = 'P0001', DETAIL = 'ADVERTISEMENT_NOT_FOUND';
    END IF;

    IF NOT v_ad_is_active THEN
        RAISE EXCEPTION 'Advertisement is not active (current status: inactive/paused)'
            USING ERRCODE = 'P0001', DETAIL = 'ADVERTISEMENT_INACTIVE';
    END IF;

    IF v_ad_user_id = v_effective_caller THEN
        RAISE EXCEPTION 'Cannot trade against your own advertisement'
            USING ERRCODE = 'P0001', DETAIL = 'SELF_TRADE_PROHIBITED';
    END IF;

    -- Enforce counterparty restrictions in the database transaction, not just API routes.
    SELECT COALESCE(is_banned, FALSE), COALESCE(is_restricted, FALSE),
           COALESCE(is_on_hold, FALSE), COALESCE(is_suspended, FALSE),
           COALESCE(is_minor_restricted, FALSE),
           LOWER(COALESCE(account_status::TEXT, ''))
    INTO v_counterparty_banned, v_counterparty_restricted, v_counterparty_on_hold,
         v_counterparty_suspended, v_counterparty_minor_restricted, v_counterparty_account_status
    FROM public.profiles WHERE id = v_ad_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Counterparty profile is unavailable. Trade creation rejected.'
            USING ERRCODE = 'P0001', DETAIL = 'COUNTERPARTY_PROFILE_UNAVAILABLE';
    END IF;
    IF v_counterparty_banned OR v_counterparty_restricted OR v_counterparty_on_hold OR v_counterparty_suspended
       OR v_counterparty_minor_restricted OR v_counterparty_account_status IS DISTINCT FROM 'active' THEN
        RAISE EXCEPTION 'The counterparty account is restricted or non-active. Trade creation is blocked.'
            USING ERRCODE = 'P0001', DETAIL = 'COUNTERPARTY_ACCOUNT_RESTRICTED';
    END IF;
    IF v_ad_asset NOT IN ('USDT', 'BTC', 'ETH', 'LTC') THEN
        RAISE EXCEPTION 'Unsupported asset for trade: %. Supported assets: USDT, BTC, ETH, LTC', v_ad_asset
            USING ERRCODE = 'P0001', DETAIL = 'UNSUPPORTED_TRADE_ASSET';
    END IF;

    IF v_ad_price <= 0 THEN
        v_ad_price := 1.0;
    END IF;

    -- 3. Determine Trade Counterparties based on Normalized Ad Type
    IF v_ad_type = 'BUY' THEN
        v_seller_id := v_effective_caller;
        v_buyer_id := v_ad_user_id;
    ELSE
        v_seller_id := v_ad_user_id;
        v_buyer_id := v_effective_caller;
    END IF;

    -- 4. Calculate Canonical Financial Amounts
    v_unit_price := v_ad_price;
    v_fiat_currency := v_ad_fiat_currency;

    v_crypto_amount := ROUND(COALESCE(p_crypto_amount, 0), 8);
    IF v_crypto_amount <= 0 AND p_fiat_amount > 0 THEN
        v_crypto_amount := ROUND((p_fiat_amount / v_unit_price), 8);
    END IF;

    IF v_crypto_amount <= 0 THEN
        RAISE EXCEPTION 'Invalid crypto amount: %', p_crypto_amount
            USING ERRCODE = 'P0001', DETAIL = 'INVALID_CRYPTO_AMOUNT';
    END IF;

    -- Mathematical consistency validation: If both are supplied, verify they match
    IF p_crypto_amount IS NOT NULL AND p_crypto_amount > 0 AND p_fiat_amount IS NOT NULL AND p_fiat_amount > 0 THEN
        IF ROUND(p_fiat_amount, 2) IS DISTINCT FROM ROUND((v_crypto_amount * v_unit_price), 2) THEN
            RAISE EXCEPTION 'Inconsistent trade parameters: Provided fiat_amount (%) does not match crypto_amount * price (%).',
                ROUND(p_fiat_amount, 2), ROUND((v_crypto_amount * v_unit_price), 2)
                USING ERRCODE = 'P0001', DETAIL = 'INCONSISTENT_TRADE_AMOUNTS';
        END IF;
    END IF;

    v_fiat_amount := ROUND((v_crypto_amount * v_unit_price), 2);
    v_escrow_fee := ROUND(v_crypto_amount * 0.015, 8);
    v_total_escrow := v_crypto_amount + v_escrow_fee;

    -- 5. Compute Deterministic Request Fingerprint
    v_request_fingerprint := encode(
        sha256(
            (v_buyer_id::TEXT || ':' ||
             v_seller_id::TEXT || ':' ||
             v_trade_ad_id || ':' ||
             v_ad_asset || ':' ||
             v_crypto_amount::TEXT || ':' ||
             v_fiat_amount::TEXT || ':' ||
             v_fiat_currency || ':' ||
             LOWER(TRIM(COALESCE(p_payment_method, ''))) || ':' ||
             v_unit_price::TEXT)::bytea
        ),
        'hex'
    );

    -- 5.1 Read Platform Emergency & Maintenance Controls
    FOR v_setting_rec IN
        SELECT key, value
        FROM public.system_settings
        WHERE key IN ('emergency_mode', 'prevent_new_trades', 'maintenance_mode')
    LOOP
        v_read_count := v_read_count + 1;
        IF v_setting_rec.key = 'emergency_mode' THEN
            v_emergency_mode_val := v_setting_rec.value;
        ELSIF v_setting_rec.key = 'prevent_new_trades' THEN
            v_prevent_new_trades_val := v_setting_rec.value;
        ELSIF v_setting_rec.key = 'maintenance_mode' THEN
            v_maintenance_mode_val := v_setting_rec.value;
        END IF;
    END LOOP;

    IF v_read_count < 3 OR v_emergency_mode_val IS NULL OR v_prevent_new_trades_val IS NULL OR v_maintenance_mode_val IS NULL THEN
        RAISE EXCEPTION 'Platform emergency control state is incomplete. Trade creation rejected for security reasons.'
            USING ERRCODE = 'P0001', DETAIL = 'PLATFORM_CONTROL_STATE_UNAVAILABLE';
    END IF;

    IF jsonb_typeof(v_emergency_mode_val) = 'boolean' THEN
        v_emergency_mode := (v_emergency_mode_val)::boolean;
    ELSIF jsonb_typeof(v_emergency_mode_val) = 'string' THEN
        v_emergency_mode := (LOWER(v_emergency_mode_val #>> '{}') IN ('true', '1', 't'));
    ELSE
        RAISE EXCEPTION 'Invalid platform control value type for emergency_mode.'
            USING ERRCODE = 'P0001', DETAIL = 'PLATFORM_CONTROL_STATE_UNAVAILABLE';
    END IF;

    IF jsonb_typeof(v_prevent_new_trades_val) = 'boolean' THEN
        v_prevent_new_trades := (v_prevent_new_trades_val)::boolean;
    ELSIF jsonb_typeof(v_prevent_new_trades_val) = 'string' THEN
        v_prevent_new_trades := (LOWER(v_prevent_new_trades_val #>> '{}') IN ('true', '1', 't'));
    ELSE
        RAISE EXCEPTION 'Invalid platform control value type for prevent_new_trades.'
            USING ERRCODE = 'P0001', DETAIL = 'PLATFORM_CONTROL_STATE_UNAVAILABLE';
    END IF;

    IF jsonb_typeof(v_maintenance_mode_val) = 'boolean' THEN
        v_maintenance_mode := (v_maintenance_mode_val)::boolean;
    ELSIF jsonb_typeof(v_maintenance_mode_val) = 'string' THEN
        v_maintenance_mode := (LOWER(v_maintenance_mode_val #>> '{}') IN ('true', '1', 't'));
    ELSE
        RAISE EXCEPTION 'Invalid platform control value type for maintenance_mode.'
            USING ERRCODE = 'P0001', DETAIL = 'PLATFORM_CONTROL_STATE_UNAVAILABLE';
    END IF;

    IF v_emergency_mode THEN
        RAISE EXCEPTION 'Platform is under Global Emergency Mode. Trade creation is suspended.'
            USING ERRCODE = 'P0001', DETAIL = 'PLATFORM_EMERGENCY_MODE';
    END IF;

    IF v_prevent_new_trades THEN
        RAISE EXCEPTION 'Initiating new P2P trades is temporarily disabled by administrator.'
            USING ERRCODE = 'P0001', DETAIL = 'P2P_TRADE_CREATION_DISABLED';
    END IF;

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

    -- 5.4 Pending Withdrawal Approval Lockout
    IF EXISTS (
        SELECT 1 FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = 'has_pending_withdrawal_approval'
    ) THEN
        IF public.has_pending_withdrawal_approval(v_effective_caller) THEN
            RAISE EXCEPTION 'WITHDRAWAL_APPROVAL_PENDING: You have a pending withdrawal awaiting administrator approval. Creating or participating in new P2P trades is restricted until this withdrawal is reviewed.'
                USING ERRCODE = 'P0001', DETAIL = 'WITHDRAWAL_APPROVAL_PENDING';
        END IF;
    END IF;

    -- 5.5 Deterministic Row Locking (Lock profiles in smaller UUID order to prevent deadlocks)
    IF v_effective_caller < v_ad_user_id THEN
        SELECT COALESCE(is_emergency_frozen, FALSE) INTO v_caller_frozen
        FROM public.profiles WHERE id = v_effective_caller FOR UPDATE;

        SELECT COALESCE(is_emergency_frozen, FALSE) INTO v_counterparty_frozen
        FROM public.profiles WHERE id = v_ad_user_id FOR UPDATE;
    ELSE
        SELECT COALESCE(is_emergency_frozen, FALSE) INTO v_counterparty_frozen
        FROM public.profiles WHERE id = v_ad_user_id FOR UPDATE;

        SELECT COALESCE(is_emergency_frozen, FALSE) INTO v_caller_frozen
        FROM public.profiles WHERE id = v_effective_caller FOR UPDATE;
    END IF;

    IF v_caller_frozen THEN
        RAISE EXCEPTION 'USER_EMERGENCY_FROZEN: Your account is currently under an emergency security freeze.'
            USING ERRCODE = 'P0001', DETAIL = 'USER_EMERGENCY_FROZEN';
    END IF;

    IF v_counterparty_frozen THEN
        RAISE EXCEPTION 'USER_EMERGENCY_FROZEN: The counterparty account is currently under an emergency security freeze.'
            USING ERRCODE = 'P0001', DETAIL = 'USER_EMERGENCY_FROZEN';
    END IF;

    v_trade_id := gen_random_uuid();
    v_public_id := COALESCE(p_trade_ref, 'TX' || SUBSTRING(REPLACE(v_trade_id::TEXT, '-', '') FROM 1 FOR 8));

    -- =========================================================================
    -- CRITICAL STEP 6: AUTHORITATIVE KYC TIER 1 / TIER 2 BUSINESS RULE ENFORCEMENT
    -- (Occurs inside deterministic profile lock BEFORE any financial mutations)
    -- =========================================================================

    -- 6.1 SELL ENFORCEMENT: SELLER MUST BE TIER 2 (KYC VERIFIED)
    v_seller_tier := public.get_user_kyc_tier(v_seller_id);
    IF v_seller_tier < 2 THEN
        RAISE EXCEPTION 'KYC verification is required to sell.'
            USING ERRCODE = 'P0001', DETAIL = 'KYC_REQUIRED';
    END IF;

    -- 6.2 BUY ENFORCEMENT: TIER 1 CUMULATIVE BUY VOLUME LIMITED TO USD $1,000.00
    -- (Tier 2 bypasses USD valuation and cumulative volume calculations entirely)
    v_buyer_tier := public.get_user_kyc_tier(v_buyer_id);
    IF v_buyer_tier < 2 THEN
        -- Compute Authoritative Execution-Time USD Valuation ONLY for Tier 1 Buyers
        IF v_fiat_currency = 'USD' AND v_fiat_amount IS NOT NULL AND v_fiat_amount > 0 THEN
            v_trade_usd_amount := v_fiat_amount;
        ELSIF v_ad_asset = 'USDT' AND v_crypto_amount IS NOT NULL AND v_crypto_amount > 0 THEN
            v_trade_usd_amount := v_crypto_amount;
        ELSE
            SELECT price_in_fiat INTO v_market_usd_price
            FROM public.crypto_market_prices
            WHERE asset_symbol = v_ad_asset AND fiat_symbol = 'USD'
            LIMIT 1;

            IF v_market_usd_price IS NOT NULL AND v_market_usd_price > 0 THEN
                v_trade_usd_amount := ROUND(v_crypto_amount * v_market_usd_price, 2);
            ELSE
                RAISE EXCEPTION 'Unable to determine USD value for BUY limit calculation for asset % in fiat %', v_ad_asset, v_fiat_currency
                    USING ERRCODE = 'P0001', DETAIL = 'USD_VALUATION_UNAVAILABLE';
            END IF;
        END IF;

        v_buyer_cum_buys := public.get_user_cumulative_buy_volume(v_buyer_id);
        IF (v_buyer_cum_buys + v_trade_usd_amount) > 1000.00 THEN
            RAISE EXCEPTION 'Tier 1 accounts can buy up to $1,000 cumulatively. Complete KYC to increase your buy limit.'
                USING ERRCODE = 'P0001', DETAIL = 'KYC_TIER1_BUY_LIMIT_EXCEEDED';
        END IF;
    ELSE
        -- Tier 2 buyers: set usd_value_at_trade snapshot ONLY if fiat is USD or asset is USDT.
        -- Tier 2 NEVER queries crypto_market_prices and NEVER fails due to market price availability.
        IF v_fiat_currency = 'USD' AND v_fiat_amount IS NOT NULL AND v_fiat_amount > 0 THEN
            v_trade_usd_amount := v_fiat_amount;
        ELSIF v_ad_asset = 'USDT' AND v_crypto_amount IS NOT NULL AND v_crypto_amount > 0 THEN
            v_trade_usd_amount := v_crypto_amount;
        ELSE
            v_trade_usd_amount := NULL;
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
    ) VALUES (
        v_buyer_id,
        v_ad_asset,
        0.0,
        0.0,
        NOW(),
        NOW()
    ) ON CONFLICT (user_id, asset_symbol) DO NOTHING;

    -- 9. Seller Balance Lock & Escrow Reservation (Live wallet_assets Schema)
    SELECT id, balance, in_escrow
    INTO v_seller_wallet_asset_id, v_seller_bal, v_seller_escrow
    FROM public.wallet_assets
    WHERE user_id = v_seller_id AND asset_symbol = v_ad_asset
    FOR UPDATE;

    IF v_seller_wallet_asset_id IS NULL THEN
        RAISE EXCEPTION 'Seller does not have an active % wallet asset record', v_ad_asset
            USING ERRCODE = 'P0001', DETAIL = 'SELLER_WALLET_ASSET_NOT_FOUND';
    END IF;

    IF v_seller_bal < v_total_escrow THEN
        RAISE EXCEPTION 'Insufficient seller balance (requires % %, available: % %)',
            v_total_escrow, v_ad_asset, v_seller_bal, v_ad_asset
            USING ERRCODE = 'P0001', DETAIL = 'INSUFFICIENT_SELLER_BALANCE';
    END IF;

    v_seller_bal_after := v_seller_bal - v_total_escrow;
    v_seller_escrow_after := v_seller_escrow + v_total_escrow;

    UPDATE public.wallet_assets
    SET balance = v_seller_bal_after,
        in_escrow = v_seller_escrow_after,
        updated_at = NOW()
    WHERE id = v_seller_wallet_asset_id;

    -- 10. Insert Canonical Trade Record (Live trades Schema with Immutable USD Snapshot & Idempotency Key)
    BEGIN
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
            usd_value_at_trade,
            idempotency_key,
            request_fingerprint,
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
            p_payment_method,
            'created',
            'escrow_locked',
            v_ad_payment_window_mins,
            v_trade_usd_amount,
            v_clean_idempotency,
            v_request_fingerprint,
            NOW(),
            NOW() + (v_ad_payment_window_mins || ' minutes')::INTERVAL,
            NOW(),
            v_ad_public_ad_id
        );
    EXCEPTION WHEN unique_violation THEN
        GET STACKED DIAGNOSTICS v_diag_constraint = CONSTRAINT_NAME;
        IF v_diag_constraint = 'idx_trades_idempotency_key' THEN
            RAISE EXCEPTION 'Idempotent trade insertion collision on key %. Please retry your request.', v_clean_idempotency
                USING ERRCODE = '23505', DETAIL = 'CONCURRENT_TRADE_RACE_RETRY_REQUIRED';
        ELSE
            RAISE; -- Re-raise unrelated unique constraint violation without masking
        END IF;
    END;

    -- 11. Ledger Entry for Escrow Lock (Live ledger_entries Schema)
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
        'status', 'created',
        'escrow_status', 'escrow_locked'
    );
END;
$$;
REVOKE ALL ON FUNCTION public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID) TO authenticated, service_role, postgres;

COMMIT;
