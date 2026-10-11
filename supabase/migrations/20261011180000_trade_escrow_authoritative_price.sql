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
    v_existing_request RECORD;
    v_request_fingerprint TEXT;
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

        -- The ad's stored price is authoritative; caller-supplied p_price is never trusted.
        v_ad_price := COALESCE(NULLIF(v_p2p_ad.price, 0), 0);

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
        LIMIT 1
        FOR UPDATE;

        IF v_legacy_ad.id IS NOT NULL THEN
            v_found_ad := TRUE;
            v_ad_user_id := v_legacy_ad.user_id;
            v_trade_ad_id := v_legacy_ad.id;
            v_ad_public_ad_id := v_legacy_ad.public_ad_id;

            -- Resolve ad UUID strictly without fabricating synthetic IDs
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

            -- The legacy ad's stored price is authoritative; caller-supplied p_price is never trusted.
            v_ad_price := COALESCE(
                NULLIF(v_legacy_ad.price, 0),
                NULLIF(v_legacy_ad.unit_price, 0),
                NULLIF(v_legacy_ad.fixed_rate, 0),
                0
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

    -- 6. Financial Calculations (Authoritative 1.5% Escrow Fee)
    v_unit_price := v_ad_price;
    v_fiat_currency := v_ad_fiat_currency;

    IF p_crypto_amount IS NOT NULL
       AND p_crypto_amount::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION 'Invalid non-finite crypto amount.';
    END IF;

    v_crypto_amount := ROUND(COALESCE(p_crypto_amount, 0), 8);
    IF v_crypto_amount <= 0 AND p_fiat_amount > 0
       AND p_fiat_amount::TEXT NOT IN ('NaN', 'Infinity', '-Infinity') THEN
        v_crypto_amount := ROUND((p_fiat_amount / v_unit_price), 8);
    END IF;

    IF v_crypto_amount <= 0 OR v_crypto_amount::TEXT IN ('NaN', 'Infinity', '-Infinity') THEN
        RAISE EXCEPTION 'Invalid crypto amount: %', p_crypto_amount;
    END IF;

    v_fiat_amount := ROUND((v_crypto_amount * v_unit_price), 2);
    v_escrow_fee := ROUND(v_crypto_amount * 0.015, 8);
    v_total_escrow := v_crypto_amount + v_escrow_fee;

    v_public_id := COALESCE(p_trade_ref, 'TX' || SUBSTRING(REPLACE(gen_random_uuid()::TEXT, '-', '') FROM 1 FOR 8));

    -- 7. Durable idempotency: serialize same-user retries and bind each key to its request.
    IF p_idempotency_key IS NULL
       OR LENGTH(BTRIM(p_idempotency_key)) < 8
       OR LENGTH(BTRIM(p_idempotency_key)) > 128 THEN
        RAISE EXCEPTION 'A valid idempotency key between 8 and 128 characters is required.';
    END IF;

    v_request_fingerprint := MD5(CONCAT_WS('|',
        COALESCE(v_ad_id::TEXT, v_ad_public_ad_id, v_trade_ad_id, p_ad_id),
        v_ad_asset,
        v_crypto_amount::TEXT,
        v_fiat_currency,
        v_unit_price::TEXT,
        LOWER(BTRIM(COALESCE(p_payment_method, 'Bank Transfer')))
    ));

    PERFORM pg_advisory_xact_lock(
        HASHtextextended(v_effective_caller::TEXT || ':' || BTRIM(p_idempotency_key), 0)
    );

    SELECT * INTO v_existing_request
    FROM public.trade_request_idempotency
    WHERE user_id = v_effective_caller
      AND idempotency_key = BTRIM(p_idempotency_key)
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing_request.request_fingerprint IS DISTINCT FROM v_request_fingerprint THEN
            RAISE EXCEPTION 'Idempotency key was already used for a different trade request.';
        END IF;
        IF v_existing_request.trade_id IS NULL THEN
            RAISE EXCEPTION 'Prior trade request requires reconciliation; duplicate creation is blocked.';
        END IF;

        SELECT * INTO v_existing_trade
        FROM public.trades
        WHERE id = v_existing_request.trade_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Prior trade record is missing; duplicate creation is blocked.';
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

    INSERT INTO public.trade_request_idempotency (
        user_id, idempotency_key, request_fingerprint, trade_id
    ) VALUES (
        v_effective_caller, BTRIM(p_idempotency_key), v_request_fingerprint, v_trade_id
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

REVOKE EXECUTE ON FUNCTION public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID) TO authenticated, service_role, postgres;

COMMIT;
