-- Read-only preflight for the paid/disputed administrator cancellation guard.
DO $preflight$
DECLARE
    v_cancel regprocedure := to_regprocedure('public.cancel_p2p_trade(uuid,uuid,text)');
    v_resolver regprocedure := to_regprocedure('public.resolve_trade_dispute(uuid,text,uuid,uuid)');
    v_definition text;
BEGIN
    IF v_cancel IS NULL OR v_resolver IS NULL THEN
        RAISE EXCEPTION 'Canonical cancel/dispute RPC is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid=v_cancel
          AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
          AND 'search_path=""' = ANY(coalesce(p.proconfig,ARRAY[]::text[]))
    ) OR NOT pg_catalog.has_function_privilege('service_role',v_cancel,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_cancel,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_cancel,'EXECUTE') THEN
        RAISE EXCEPTION 'Cancellation function is not postgres-owned, empty-path and service-only';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_cancel) INTO v_definition;
    IF pg_catalog.strpos(v_definition,'v_open_dispute_count INTEGER := 0')=0
       OR pg_catalog.strpos(v_definition,'ADMIN_CANCEL_REQUIRES_SINGLE_OPEN_DISPUTE')=0
       OR pg_catalog.strpos(v_definition,'SELECT COUNT(*)')=0
       OR pg_catalog.strpos(v_definition,'LOWER(status::text) = ''open''')=0
       OR pg_catalog.strpos(v_definition,'IF (v_is_paid OR v_is_disputed) AND v_open_dispute_count <> 1')=0 THEN
        RAISE EXCEPTION 'Admin cancellation does not require exactly one open dispute for paid/disputed escrow';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid=v_resolver AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
          AND 'search_path=""' = ANY(coalesce(p.proconfig,ARRAY[]::text[]))
          AND pg_catalog.strpos(p.prosrc,'public.cancel_p2p_trade(')>0
    ) OR NOT pg_catalog.has_function_privilege('service_role',v_resolver,'EXECUTE') THEN
        RAISE EXCEPTION 'Canonical dispute resolver lost its trusted cancellation call path';
    END IF;

    IF (
        SELECT count(*)
        FROM pg_catalog.pg_proc caller
        JOIN pg_catalog.pg_namespace n ON n.oid=caller.pronamespace
        WHERE n.nspname='public'
          AND caller.oid<>v_cancel
          AND pg_catalog.strpos(caller.prosrc,'public.cancel_p2p_trade(')>0
    ) <> 1 THEN
        RAISE EXCEPTION 'Unexpected installed database callers of cancel_p2p_trade';
    END IF;
END;
$preflight$;
