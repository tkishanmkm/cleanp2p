-- Enforce the SELL inventory interlock inside the exposed SECURITY DEFINER
-- escrow RPC. API/UI restrictions alone do not protect a directly invoked RPC.
BEGIN;

DO $migration$
DECLARE
    v_oid OID;
    v_definition TEXT;
    v_updated TEXT;
    v_old TEXT;
    v_new TEXT;
BEGIN
    v_oid := pg_catalog.to_regprocedure(
        'public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)'
    );
    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'Required initiate_trade_with_escrow RPC is missing.';
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(v_oid);
    v_definition := pg_catalog.replace(v_definition, E'\r\n', E'\n');

    v_old := E'    IF NOT v_ad_is_active THEN\n        RAISE EXCEPTION ''Advertisement is not active (current status: inactive/paused)''\n            USING ERRCODE = ''P0001'', DETAIL = ''ADVERTISEMENT_INACTIVE'';\n    END IF;\n\n    IF v_ad_user_id = v_effective_caller THEN';
    IF pg_catalog.strpos(v_definition, v_old) = 0
       OR pg_catalog.strpos(
           pg_catalog.substr(v_definition, pg_catalog.strpos(v_definition, v_old) + pg_catalog.length(v_old)),
           v_old
       ) > 0 THEN
        RAISE EXCEPTION 'Could not locate exactly one active-ad/self-trade guard boundary; aborting.';
    END IF;

    v_new := E'    IF NOT v_ad_is_active THEN\n        RAISE EXCEPTION ''Advertisement is not active (current status: inactive/paused)''\n            USING ERRCODE = ''P0001'', DETAIL = ''ADVERTISEMENT_INACTIVE'';\n    END IF;\n\n    -- SELL listings are disabled until their advertised crypto inventory is\n    -- reserved per-ad and restored exactly once on cancellation/refund. The\n    -- seller wallet lock protects total wallet funds, but does not guarantee\n    -- the remaining quantity displayed on an individual SELL ad. Enforce the\n    -- interlock here as authenticated users can call this RPC directly.\n    IF v_ad_type = ''SELL'' THEN\n        RAISE EXCEPTION ''SELL advertisements are temporarily unavailable until atomic per-ad inventory reservation is enabled.''\n            USING ERRCODE = ''P0001'', DETAIL = ''SELL_AD_INVENTORY_RESERVATION_UNVERIFIED'';\n    END IF;\n\n    IF v_ad_type IS DISTINCT FROM ''BUY'' THEN\n        RAISE EXCEPTION ''Unsupported advertisement direction.''\n            USING ERRCODE = ''P0001'', DETAIL = ''INVALID_AD_DIRECTION'';\n    END IF;\n\n    IF v_ad_user_id = v_effective_caller THEN';

    v_updated := pg_catalog.replace(v_definition, v_old, v_new);

    IF pg_catalog.strpos(v_updated, 'SELL_AD_INVENTORY_RESERVATION_UNVERIFIED') = 0
       OR pg_catalog.strpos(v_updated, 'IF v_ad_type IS DISTINCT FROM ''BUY''') = 0
       OR pg_catalog.strpos(v_updated, v_old) > 0 THEN
        RAISE EXCEPTION 'SELL inventory interlock patch verification failed; aborting.';
    END IF;

    EXECUTE v_updated;
END;
$migration$;

COMMENT ON FUNCTION public.initiate_trade_with_escrow(TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID) IS
    'Authenticated escrow trade initiation. SELL advertisements are rejected until a transactional per-ad inventory reservation and idempotent release lifecycle is deployed.';

COMMIT;
