-- Wayones: enforce P2P trade creation invariants at the database boundary.
-- This guard runs inside the canonical SECURITY DEFINER trade RPC transaction.
BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_trade_creation_invariants()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_buyer_id UUID;
    v_seller_id UUID;
    v_initiator_id UUID;
    v_user_id UUID;
    v_profile JSONB;
    v_ad JSONB;
    v_ad_source TEXT;
    v_ad_type TEXT;
    v_ad_status TEXT;
    v_ad_owner_id UUID;
    v_ad_asset TEXT;
    v_ad_fiat_currency TEXT;
    v_ad_price NUMERIC;
    v_payment_methods JSONB;
    v_payment_method TEXT;
    v_min_fiat NUMERIC;
    v_max_fiat NUMERIC;
    v_account_status TEXT;
    v_is_banned BOOLEAN;
    v_is_restricted BOOLEAN;
    v_is_suspended BOOLEAN;
    v_is_on_hold BOOLEAN;
    v_is_frozen BOOLEAN;
    v_require_full_name BOOLEAN;
    v_require_verified BOOLEAN;
BEGIN
    BEGIN
        v_buyer_id := NULLIF(NEW.buyer_id::TEXT, '')::UUID;
        v_seller_id := NULLIF(NEW.seller_id::TEXT, '')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
        RAISE EXCEPTION 'Trade participants must be valid user IDs.'
            USING ERRCODE = 'P0001', DETAIL = 'INVALID_TRADE_PARTICIPANT';
    END;

    IF v_buyer_id IS NULL OR v_seller_id IS NULL OR v_buyer_id = v_seller_id THEN
        RAISE EXCEPTION 'Trade requires two distinct valid participants.'
            USING ERRCODE = 'P0001', DETAIL = 'INVALID_TRADE_PARTICIPANT';
    END IF;

    -- Authenticated callers must be one of the two trade participants.
    -- The canonical SECURITY DEFINER RPC still performs its own caller binding.
    IF auth.role() IS DISTINCT FROM 'service_role'
       AND SESSION_USER NOT IN ('postgres', 'supabase_admin')
       AND (auth.uid() IS NULL OR auth.uid() NOT IN (v_buyer_id, v_seller_id)) THEN
        RAISE EXCEPTION 'Authenticated caller is not a trade participant.'
            USING ERRCODE = 'P0001', DETAIL = 'TRADE_CALLER_NOT_PARTICIPANT';
    END IF;

    -- Lock and validate both participants in deterministic UUID order.
    FOR v_user_id IN
        SELECT candidate_id
        FROM pg_catalog.unnest(ARRAY[v_buyer_id, v_seller_id]) AS ids(candidate_id)
        ORDER BY candidate_id
    LOOP
        SELECT pg_catalog.to_jsonb(p)
        INTO v_profile
        FROM public.profiles AS p
        WHERE p.id = v_user_id
        FOR UPDATE;

        IF v_profile IS NULL THEN
            RAISE EXCEPTION 'Trade participant profile is missing.'
                USING ERRCODE = 'P0001', DETAIL = 'TRADE_PARTICIPANT_PROFILE_MISSING';
        END IF;

        v_account_status := pg_catalog.lower(COALESCE(
            NULLIF(v_profile ->> 'account_status', ''),
            NULLIF(v_profile ->> 'status', ''),
            'active'
        ));
        v_is_banned := COALESCE((v_profile ->> 'is_banned')::BOOLEAN, FALSE);
        v_is_restricted := COALESCE((v_profile ->> 'is_restricted')::BOOLEAN, FALSE);
        v_is_suspended := COALESCE((v_profile ->> 'is_suspended')::BOOLEAN, FALSE);
        v_is_on_hold := COALESCE((v_profile ->> 'is_on_hold')::BOOLEAN, FALSE);
        v_is_frozen := COALESCE((v_profile ->> 'is_emergency_frozen')::BOOLEAN, FALSE);

        IF v_is_banned OR v_is_restricted OR v_is_suspended OR v_is_on_hold OR v_is_frozen
           OR v_account_status IN ('banned', 'restricted', 'suspended', 'on_hold', 'hold', 'frozen', 'disabled', 'closed', 'deleted', 'deletion_pending') THEN
            RAISE EXCEPTION 'Trade is unavailable because a participant account is restricted.'
                USING ERRCODE = 'P0001', DETAIL = 'TRADE_PARTICIPANT_ACCOUNT_RESTRICTED';
        END IF;
    END LOOP;

    -- Resolve the exact advertisement used by the canonical trade row.
    SELECT pg_catalog.to_jsonb(a)
    INTO v_ad
    FROM public.p2p_ads AS a
    WHERE a.id::TEXT = NEW.ad_id::TEXT
    LIMIT 1;
    IF v_ad IS NOT NULL THEN v_ad_source := 'p2p_ads'; END IF;

    IF v_ad IS NULL AND NEW.public_ad_id IS NOT NULL THEN
        SELECT pg_catalog.to_jsonb(a)
        INTO v_ad
        FROM public.p2p_ads AS a
        WHERE a.public_ad_id::TEXT = NEW.public_ad_id::TEXT
        LIMIT 1;
        IF v_ad IS NOT NULL THEN v_ad_source := 'p2p_ads'; END IF;
    END IF;

    IF v_ad IS NULL AND NEW.ad_id IS NOT NULL THEN
        SELECT pg_catalog.to_jsonb(a)
        INTO v_ad
        FROM public.ads AS a
        WHERE a.id::TEXT = NEW.ad_id::TEXT
        LIMIT 1;
        IF v_ad IS NOT NULL THEN v_ad_source := 'ads'; END IF;
    END IF;

    IF v_ad IS NULL THEN
        RAISE EXCEPTION 'Trade advertisement could not be resolved.'
            USING ERRCODE = 'P0001', DETAIL = 'TRADE_ADVERTISEMENT_NOT_FOUND';
    END IF;

    v_ad_type := pg_catalog.upper(COALESCE(v_ad ->> 'type', 'SELL'));
    v_ad_status := pg_catalog.upper(COALESCE(v_ad ->> 'status', ''));
    v_ad_owner_id := NULLIF(v_ad ->> 'user_id', '')::UUID;
    v_ad_asset := CASE
        WHEN v_ad_source = 'p2p_ads' THEN pg_catalog.upper(COALESCE(v_ad ->> 'crypto', v_ad ->> 'asset', 'USDT'))
        ELSE pg_catalog.upper(COALESCE(v_ad ->> 'crypto', 'USDT'))
    END;
    v_ad_fiat_currency := pg_catalog.upper(COALESCE(v_ad ->> 'fiat_currency', 'USD'));
    v_ad_price := COALESCE(NULLIF(v_ad ->> 'price', '')::NUMERIC, 1);

    IF v_ad_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Advertisement is no longer active.'
            USING ERRCODE = 'P0001', DETAIL = 'TRADE_ADVERTISEMENT_INACTIVE';
    END IF;

    IF v_ad_owner_id IS NULL
       OR (v_ad_type = 'BUY' AND v_ad_owner_id <> v_buyer_id)
       OR (v_ad_type <> 'BUY' AND v_ad_owner_id <> v_seller_id) THEN
        RAISE EXCEPTION 'Trade participants do not match the advertisement owner.'
            USING ERRCODE = 'P0001', DETAIL = 'TRADE_AD_OWNER_MISMATCH';
    END IF;

    v_initiator_id := CASE WHEN v_ad_type = 'BUY' THEN v_seller_id ELSE v_buyer_id END;

    -- Revalidate the exact price/currency and amount math against the current ad row.
    IF v_ad_price <= 0 OR NEW.unit_price IS DISTINCT FROM v_ad_price
       OR pg_catalog.upper(COALESCE(NEW.fiat_currency, '')) IS DISTINCT FROM v_ad_fiat_currency
       OR pg_catalog.upper(COALESCE(NEW.crypto, NEW.asset_code, '')) IS DISTINCT FROM v_ad_asset
       OR NEW.crypto_amount IS NULL OR NEW.crypto_amount <= 0
       OR NEW.fiat_amount IS DISTINCT FROM pg_catalog.round(NEW.crypto_amount * NEW.unit_price, 2) THEN
        RAISE EXCEPTION 'Trade price, asset, currency or amount does not match the current advertisement.'
            USING ERRCODE = 'P0001', DETAIL = 'TRADE_AD_PARAMETERS_MISMATCH';
    END IF;

    -- The database, not the client route, enforces the advertisement's fiat bounds.
    v_min_fiat := COALESCE(
        NULLIF(v_ad ->> 'min_amount', '')::NUMERIC,
        NULLIF(v_ad ->> 'min_limit', '')::NUMERIC,
        0
    );
    v_max_fiat := COALESCE(
        NULLIF(v_ad ->> 'max_amount', '')::NUMERIC,
        NULLIF(v_ad ->> 'max_limit', '')::NUMERIC
    );

    IF v_min_fiat < 0 OR (v_max_fiat IS NOT NULL AND v_max_fiat < v_min_fiat) THEN
        RAISE EXCEPTION 'Advertisement fiat limits are invalid.'
            USING ERRCODE = 'P0001', DETAIL = 'TRADE_ADVERTISEMENT_LIMITS_INVALID';
    END IF;

    IF NEW.fiat_amount IS NULL OR NEW.fiat_amount <= 0
       OR NEW.fiat_amount < v_min_fiat
       OR (v_max_fiat IS NOT NULL AND NEW.fiat_amount > v_max_fiat) THEN
        RAISE EXCEPTION 'Trade amount is outside the advertisement limits.'
            USING ERRCODE = 'P0001', DETAIL = 'TRADE_AMOUNT_OUTSIDE_AD_LIMITS';
    END IF;

    -- Validate payment method against the ad's configured allowlist.
    v_payment_method := pg_catalog.lower(pg_catalog.btrim(COALESCE(NEW.payment_method, '')));
    IF v_payment_method = '' THEN
        RAISE EXCEPTION 'A payment method is required.'
            USING ERRCODE = 'P0001', DETAIL = 'TRADE_PAYMENT_METHOD_REQUIRED';
    END IF;

    v_payment_methods := v_ad -> 'payment_methods';
    IF pg_catalog.jsonb_typeof(v_payment_methods) = 'string' THEN
        BEGIN
            v_payment_methods := (v_payment_methods #>> '{}')::JSONB;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Advertisement payment method configuration is invalid.'
                USING ERRCODE = 'P0001', DETAIL = 'TRADE_PAYMENT_METHOD_CONFIG_INVALID';
        END;
    END IF;

    IF v_payment_methods IS NULL OR pg_catalog.jsonb_typeof(v_payment_methods) = 'null'
       OR (pg_catalog.jsonb_typeof(v_payment_methods) = 'array' AND pg_catalog.jsonb_array_length(v_payment_methods) = 0) THEN
        v_payment_methods := '["Bank Transfer"]'::JSONB;
    END IF;

    IF pg_catalog.jsonb_typeof(v_payment_methods) <> 'array' THEN
        RAISE EXCEPTION 'Advertisement payment method configuration is invalid.'
            USING ERRCODE = 'P0001', DETAIL = 'TRADE_PAYMENT_METHOD_CONFIG_INVALID';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_array_elements_text(v_payment_methods) AS method(value)
        WHERE pg_catalog.lower(pg_catalog.btrim(method.value)) = v_payment_method
    ) THEN
        RAISE EXCEPTION 'Selected payment method is not enabled for this advertisement.'
            USING ERRCODE = 'P0001', DETAIL = 'TRADE_PAYMENT_METHOD_NOT_ALLOWED';
    END IF;

    -- Enforce optional ad-level identity requirements for the actual initiator.
    v_require_full_name := COALESCE((v_ad ->> 'require_full_name_verified')::BOOLEAN, FALSE);
    v_require_verified := COALESCE((v_ad ->> 'require_verified_users')::BOOLEAN, FALSE);

    IF v_require_full_name OR v_require_verified THEN
        SELECT pg_catalog.to_jsonb(p)
        INTO v_profile
        FROM public.profiles AS p
        WHERE p.id = v_initiator_id
        FOR UPDATE;

        IF v_profile IS NULL OR public.get_user_kyc_tier(v_initiator_id) < 2 THEN
            RAISE EXCEPTION 'This advertisement requires completed identity verification.'
                USING ERRCODE = 'P0001', DETAIL = 'AD_REQUIRES_KYC_TIER_2';
        END IF;

        IF v_require_full_name AND NULLIF(pg_catalog.btrim(COALESCE(v_profile ->> 'full_name', '')), '') IS NULL THEN
            RAISE EXCEPTION 'This advertisement requires a verified full legal name.'
                USING ERRCODE = 'P0001', DETAIL = 'AD_REQUIRES_VERIFIED_FULL_NAME';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

ALTER FUNCTION public.enforce_trade_creation_invariants() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.enforce_trade_creation_invariants() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_enforce_trade_creation_invariants ON public.trades;
CREATE TRIGGER trg_enforce_trade_creation_invariants
    BEFORE INSERT ON public.trades
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_trade_creation_invariants();

-- Direct INSERTs bypass the escrow reservation RPC and are not permitted.
-- The canonical SECURITY DEFINER RPC is owned by postgres and performs the atomic insert.
DROP POLICY IF EXISTS "trades_insert_policy" ON public.trades;
CREATE POLICY "trades_insert_policy" ON public.trades
    FOR INSERT WITH CHECK (FALSE);

REVOKE INSERT ON TABLE public.trades FROM PUBLIC, anon, authenticated, service_role;
GRANT INSERT ON TABLE public.trades TO postgres;
ALTER FUNCTION public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID) OWNER TO postgres;
ALTER FUNCTION public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID) SET search_path = pg_catalog, public, pg_temp;

COMMIT;
