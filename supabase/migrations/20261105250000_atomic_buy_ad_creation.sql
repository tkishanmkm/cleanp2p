-- Create BUY advertisements in both marketplace representations atomically.
-- SELL remains disabled until a corresponding inventory reservation/consumption/
-- release state machine is implemented end-to-end.
BEGIN;

CREATE OR REPLACE FUNCTION public.create_buy_ad_atomic(
    p_public_ad_id TEXT,
    p_asset TEXT,
    p_fiat TEXT,
    p_price NUMERIC,
    p_min_amount NUMERIC,
    p_max_amount NUMERIC,
    p_pricing_type TEXT,
    p_margin NUMERIC,
    p_payment_methods TEXT[],
    p_payment_window INTEGER,
    p_terms TEXT DEFAULT NULL,
    p_offer_label TEXT DEFAULT NULL,
    p_auto_reply TEXT DEFAULT NULL,
    p_tags TEXT[] DEFAULT '{}'::TEXT[],
    p_targeted_countries TEXT[] DEFAULT '{}'::TEXT[],
    p_blocked_countries TEXT[] DEFAULT '{}'::TEXT[],
    p_min_completed_trades INTEGER DEFAULT 0,
    p_require_full_name_verified BOOLEAN DEFAULT FALSE,
    p_require_verified_users BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_actor UUID := auth.uid();
    v_profile RECORD;
    v_prevent_new_ads JSONB;
    v_emergency_mode JSONB;
    v_maintenance_mode JSONB;
    v_public_id TEXT := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_public_ad_id, '')));
    v_asset TEXT := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_asset, '')));
    v_fiat TEXT := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_fiat, '')));
    v_pricing_type TEXT := pg_catalog.upper(pg_catalog.btrim(COALESCE(p_pricing_type, '')));
    v_price NUMERIC(36,18);
    v_reference_price NUMERIC(36,18);
    v_market_updated_at TIMESTAMPTZ;
    v_min NUMERIC(36,18);
    v_max NUMERIC(36,18);
    v_margin NUMERIC(12,6);
    v_methods TEXT[];
    v_tags TEXT[];
    v_targeted TEXT[];
    v_blocked TEXT[];
    v_terms TEXT := COALESCE(p_terms, '');
    v_label TEXT := COALESCE(p_offer_label, '');
    v_auto_reply TEXT := COALESCE(p_auto_reply, '');
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_ad public.ads%ROWTYPE;
    v_p2p_id UUID;
BEGIN
    IF auth.role() IS DISTINCT FROM 'authenticated' OR v_actor IS NULL THEN
        RAISE EXCEPTION 'An authenticated user session is required to create an advertisement.'
            USING ERRCODE = '42501', DETAIL = 'AUTHENTICATION_REQUIRED';
    END IF;

    IF v_public_id !~ '^[A-Z0-9]{12}$'
       OR v_asset NOT IN ('USDT', 'BTC', 'ETH', 'LTC')
       OR v_fiat !~ '^[A-Z]{3}$'
       OR v_pricing_type NOT IN ('FIXED', 'FLOAT')
       OR p_price IS NULL
       OR p_price::text IN ('NaN', 'Infinity', '-Infinity')
       OR p_price <= 0 OR p_price >= 1000000000000000000::numeric
       OR p_min_amount IS NULL
       OR p_min_amount::text IN ('NaN', 'Infinity', '-Infinity')
       OR p_min_amount <= 0 OR p_min_amount >= 1000000000000000000::numeric
       OR p_max_amount IS NULL
       OR p_max_amount::text IN ('NaN', 'Infinity', '-Infinity')
       OR p_max_amount < p_min_amount OR p_max_amount >= 1000000000000000000::numeric
       OR p_margin IS NULL
       OR p_margin::text IN ('NaN', 'Infinity', '-Infinity')
       OR p_margin < -50 OR p_margin > 50
       OR p_payment_window IS NULL OR p_payment_window < 30 OR p_payment_window > 1440
       OR p_min_completed_trades IS NULL OR p_min_completed_trades < 0 OR p_min_completed_trades > 1000000
       OR pg_catalog.length(v_terms) > 2000
       OR pg_catalog.length(v_label) > 80
       OR pg_catalog.length(v_auto_reply) > 1000 THEN
        RAISE EXCEPTION 'The advertisement payload contains an invalid field.'
            USING ERRCODE = '22023', DETAIL = 'INVALID_ADVERTISEMENT_PAYLOAD';
    END IF;

    v_price := p_price::NUMERIC(36,18);
    v_min := p_min_amount::NUMERIC(36,18);
    v_max := p_max_amount::NUMERIC(36,18);
    v_margin := p_margin::NUMERIC(12,6);

    -- Price is verified against a recent authoritative server-side quote. FIXED
    -- ads are range-checked; FLOAT ads always have their execution price recomputed
    -- here so a direct RPC caller cannot spoof the client's market price.
    SELECT cp.price_in_fiat, cp.updated_at
      INTO v_reference_price, v_market_updated_at
      FROM public.crypto_market_prices AS cp
     WHERE cp.asset_symbol = v_asset
       AND cp.fiat_symbol = v_fiat
     ORDER BY cp.updated_at DESC
     LIMIT 1
     FOR SHARE;

    IF NOT FOUND
       OR v_reference_price IS NULL
       OR v_reference_price::TEXT IN ('NaN', 'Infinity', '-Infinity')
       OR v_reference_price <= 0
       OR v_market_updated_at IS NULL
       OR v_market_updated_at > v_now + INTERVAL '1 minute'
       OR v_market_updated_at < v_now - INTERVAL '10 minutes' THEN
        RAISE EXCEPTION 'A fresh reference price is unavailable for %/%', v_asset, v_fiat
            USING ERRCODE = '55000', DETAIL = 'MARKET_PRICE_UNAVAILABLE';
    END IF;

    IF v_pricing_type = 'FIXED' THEN
        IF v_price < v_reference_price * 0.50
           OR v_price > v_reference_price * 1.50 THEN
            RAISE EXCEPTION 'Fixed price must be within fifty percent of the current market reference.'
                USING ERRCODE = '22023', DETAIL = 'FIXED_PRICE_OUTSIDE_MARKET_RANGE';
        END IF;
    ELSE
        v_price := ROUND(v_reference_price * (1 + (v_margin / 100)), 18);
        IF v_price <= 0 OR v_price >= 1000000000000000000::numeric THEN
            RAISE EXCEPTION 'Calculated floating advertisement price is invalid.'
                USING ERRCODE = '22023', DETAIL = 'INVALID_FLOATING_PRICE';
        END IF;
    END IF;

    IF p_payment_methods IS NULL
       OR pg_catalog.cardinality(p_payment_methods) < 1
       OR pg_catalog.cardinality(p_payment_methods) > 20
       OR EXISTS (
            SELECT 1
              FROM pg_catalog.unnest(p_payment_methods) AS method(value)
             WHERE method.value IS NULL
                OR pg_catalog.length(pg_catalog.btrim(method.value)) < 1
                OR pg_catalog.length(pg_catalog.btrim(method.value)) > 100
       ) THEN
        RAISE EXCEPTION 'Select between one and twenty valid payment methods.'
            USING ERRCODE = '22023', DETAIL = 'INVALID_PAYMENT_METHODS';
    END IF;

    v_methods := ARRAY(
        SELECT DISTINCT pg_catalog.btrim(method.value)
          FROM pg_catalog.unnest(p_payment_methods) AS method(value)
         ORDER BY pg_catalog.btrim(method.value)
    );
    IF pg_catalog.cardinality(v_methods) < 1 THEN
        RAISE EXCEPTION 'At least one valid payment method is required.'
            USING ERRCODE = '22023', DETAIL = 'INVALID_PAYMENT_METHODS';
    END IF;

    IF COALESCE(pg_catalog.cardinality(p_tags), 0) > 20
       OR EXISTS (
            SELECT 1 FROM pg_catalog.unnest(COALESCE(p_tags, '{}'::TEXT[])) AS tag(value)
             WHERE tag.value IS NULL OR pg_catalog.length(pg_catalog.btrim(tag.value)) > 40
       ) THEN
        RAISE EXCEPTION 'Advertisement tags are invalid.'
            USING ERRCODE = '22023', DETAIL = 'INVALID_AD_TAGS';
    END IF;
    v_tags := ARRAY(
        SELECT DISTINCT pg_catalog.btrim(tag.value)
          FROM pg_catalog.unnest(COALESCE(p_tags, '{}'::TEXT[])) AS tag(value)
         WHERE pg_catalog.btrim(tag.value) <> ''
         ORDER BY pg_catalog.btrim(tag.value)
    );

    IF COALESCE(pg_catalog.cardinality(p_targeted_countries), 0) > 100
       OR COALESCE(pg_catalog.cardinality(p_blocked_countries), 0) > 100
       OR EXISTS (
            SELECT 1 FROM pg_catalog.unnest(COALESCE(p_targeted_countries, '{}'::TEXT[])) AS country(value)
             WHERE country.value !~* '^[a-z]{2}$'
       )
       OR EXISTS (
            SELECT 1 FROM pg_catalog.unnest(COALESCE(p_blocked_countries, '{}'::TEXT[])) AS country(value)
             WHERE country.value !~* '^[a-z]{2}$'
       ) THEN
        RAISE EXCEPTION 'Advertisement country restrictions must be ISO alpha-2 codes.'
            USING ERRCODE = '22023', DETAIL = 'INVALID_COUNTRY_RESTRICTIONS';
    END IF;
    v_targeted := ARRAY(
        SELECT DISTINCT pg_catalog.lower(country.value)
          FROM pg_catalog.unnest(COALESCE(p_targeted_countries, '{}'::TEXT[])) AS country(value)
         ORDER BY pg_catalog.lower(country.value)
    );
    v_blocked := ARRAY(
        SELECT DISTINCT pg_catalog.lower(country.value)
          FROM pg_catalog.unnest(COALESCE(p_blocked_countries, '{}'::TEXT[])) AS country(value)
         ORDER BY pg_catalog.lower(country.value)
    );

    -- Serialize global control reads with administrator updates.
    SELECT s.value INTO v_prevent_new_ads
      FROM public.system_settings AS s
     WHERE s.key = 'prevent_new_ads'
     FOR SHARE;
    SELECT s.value INTO v_emergency_mode
      FROM public.system_settings AS s
     WHERE s.key = 'emergency_mode'
     FOR SHARE;
    SELECT s.value INTO v_maintenance_mode
      FROM public.system_settings AS s
     WHERE s.key = 'maintenance_mode'
     FOR SHARE;

    IF v_prevent_new_ads IS NULL OR pg_catalog.jsonb_typeof(v_prevent_new_ads) IS DISTINCT FROM 'boolean'
       OR v_emergency_mode IS NULL OR pg_catalog.jsonb_typeof(v_emergency_mode) IS DISTINCT FROM 'boolean'
       OR v_maintenance_mode IS NULL OR pg_catalog.jsonb_typeof(v_maintenance_mode) IS DISTINCT FROM 'boolean' THEN
        RAISE EXCEPTION 'Platform controls are unavailable; advertisement creation is paused.'
            USING ERRCODE = '55000', DETAIL = 'PLATFORM_CONTROL_STATE_UNAVAILABLE';
    END IF;

    IF v_prevent_new_ads = 'true'::jsonb
       OR v_emergency_mode = 'true'::jsonb
       OR v_maintenance_mode = 'true'::jsonb THEN
        RAISE EXCEPTION 'New advertisements are currently disabled by platform controls.'
            USING ERRCODE = '42501', DETAIL = 'PLATFORM_AD_CREATION_DISABLED';
    END IF;

    -- Lock and verify the caller's profile. Never provision a profile during an ad write.
    SELECT
        p.status::TEXT AS status,
        p.account_status::TEXT AS account_status,
        COALESCE(p.is_banned, FALSE) AS is_banned,
        COALESCE(p.is_restricted, FALSE) AS is_restricted,
        COALESCE(p.is_suspended, FALSE) AS is_suspended,
        COALESCE(p.is_on_hold, FALSE) AS is_on_hold,
        COALESCE(p.is_emergency_frozen, FALSE) AS is_emergency_frozen,
        COALESCE(p.is_minor_restricted, FALSE) AS is_minor_restricted
      INTO v_profile
      FROM public.profiles AS p
     WHERE p.id = v_actor
     FOR SHARE;

    IF NOT FOUND
       OR v_profile.is_banned OR v_profile.is_restricted OR v_profile.is_suspended
       OR v_profile.is_on_hold OR v_profile.is_emergency_frozen OR v_profile.is_minor_restricted
       OR pg_catalog.lower(COALESCE(v_profile.status, '')) IN (
            'banned', 'restricted', 'suspended', 'deleted', 'inactive',
            'on_hold', 'hold', 'deletion_pending'
       )
       OR pg_catalog.upper(COALESCE(v_profile.account_status, '')) IN (
            'BANNED', 'RESTRICTED', 'SUSPENDED', 'DELETED', 'INACTIVE',
            'ON_HOLD', 'HOLD', 'BLOCKED', 'DELETION_PENDING'
       ) THEN
        RAISE EXCEPTION 'This account is not allowed to create advertisements.'
            USING ERRCODE = '42501', DETAIL = 'ACCOUNT_AD_ACCESS_BLOCKED';
    END IF;

    -- This transaction intentionally supports BUY only. SELL inventory requires
    -- its own atomic reservation, consumption, cancel and restore lifecycle.
    INSERT INTO public.ads (
        public_id, public_ad_id, user_id, type, trade_type,
        asset_symbol, asset, coin, crypto_currency,
        fiat_symbol, fiat_currency, currency,
        price, unit_price, pricing_type, price_type, rate_type, is_fixed, fixed_rate, fixed_price,
        margin, margin_percentage, rate_percent, rate_adjustment,
        min_amount, max_amount, min_limit, max_limit, total_amount, available_amount,
        payment_methods, payment_window, payment_window_minutes,
        terms, offer_label, label, auto_reply, ad_tags, tags,
        targeted_countries, blocked_countries, allowed_countries,
        min_completed_trades, min_trade_count,
        require_full_name_verified, require_verified_users, require_kyc,
        active, is_active, status, is_deleted, created_at, updated_at
    )
    VALUES (
        v_public_id, v_public_id, v_actor, 'BUY', 'BUY',
        v_asset, v_asset, v_asset, v_asset,
        v_fiat, v_fiat, v_fiat,
        v_price, v_price,
        CASE WHEN v_pricing_type = 'FIXED' THEN 'fixed' ELSE 'floating' END,
        CASE WHEN v_pricing_type = 'FIXED' THEN 'fixed' ELSE 'floating' END,
        CASE WHEN v_pricing_type = 'FIXED' THEN 'fixed' ELSE 'market' END,
        v_pricing_type = 'FIXED',
        CASE WHEN v_pricing_type = 'FIXED' THEN v_price ELSE NULL END,
        CASE WHEN v_pricing_type = 'FIXED' THEN v_price ELSE NULL END,
        v_margin, v_margin, v_margin, v_margin,
        v_min, v_max, v_min, v_max, NULL, NULL,
        v_methods, p_payment_window, p_payment_window,
        v_terms, v_label, v_label, v_auto_reply, v_tags, v_tags,
        v_targeted, v_blocked, v_targeted,
        p_min_completed_trades, p_min_completed_trades,
        COALESCE(p_require_full_name_verified, FALSE),
        COALESCE(p_require_verified_users, FALSE),
        COALESCE(p_require_verified_users, FALSE),
        TRUE, TRUE, 'active', FALSE, v_now, v_now
    )
    RETURNING * INTO v_ad;

    INSERT INTO public.p2p_ads (
        public_ad_id, user_id, ad_type, type,
        crypto_currency, fiat_currency, asset_symbol, fiat_symbol, coin,
        price, pricing_type, margin,
        min_limit, max_limit, payment_method, payment_methods, terms,
        active, is_active, status, is_deleted, created_at,
        min_completed_trades_req
    )
    VALUES (
        v_public_id, v_actor, 'buy', 'BUY',
        v_asset, v_fiat, v_asset, v_fiat, v_asset,
        v_price, CASE WHEN v_pricing_type = 'FIXED' THEN 'fixed' ELSE 'floating' END, v_margin,
        v_min, v_max, v_methods[1], pg_catalog.to_jsonb(v_methods), v_terms,
        TRUE, TRUE, 'ACTIVE', FALSE, v_now,
        p_min_completed_trades
    )
    RETURNING id INTO v_p2p_id;

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'ad_id', v_ad.id,
        'public_ad_id', v_public_id,
        'p2p_ad_id', v_p2p_id,
        'ad_type', 'BUY',
        'status', 'ACTIVE',
        'price', v_ad.price,
        'pricing_type', v_ad.pricing_type,
        'margin', v_ad.margin,
        'min_limit', v_ad.min_limit,
        'max_limit', v_ad.max_limit,
        'created_at', v_now
    );
END;
$function$;

ALTER FUNCTION public.create_buy_ad_atomic(
    TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC,
    TEXT[], INTEGER, TEXT, TEXT, TEXT, TEXT[], TEXT[], TEXT[],
    INTEGER, BOOLEAN, BOOLEAN
) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.create_buy_ad_atomic(
    TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC,
    TEXT[], INTEGER, TEXT, TEXT, TEXT, TEXT[], TEXT[], TEXT[],
    INTEGER, BOOLEAN, BOOLEAN
) FROM PUBLIC, anon, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION public.create_buy_ad_atomic(
    TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC,
    TEXT[], INTEGER, TEXT, TEXT, TEXT, TEXT[], TEXT[], TEXT[],
    INTEGER, BOOLEAN, BOOLEAN
) TO authenticated;

COMMENT ON FUNCTION public.create_buy_ad_atomic(
    TEXT, TEXT, TEXT, NUMERIC, NUMERIC, NUMERIC, TEXT, NUMERIC,
    TEXT[], INTEGER, TEXT, TEXT, TEXT, TEXT[], TEXT[], TEXT[],
    INTEGER, BOOLEAN, BOOLEAN
) IS 'Creates a BUY advertisement in ads and p2p_ads in one transaction. SELL is excluded until atomic inventory reservation and release is available.';

COMMIT;
