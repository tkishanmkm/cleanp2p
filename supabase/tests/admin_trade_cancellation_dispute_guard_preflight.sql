-- Read-only preflight for the paid/disputed administrator cancellation guard.
DO $preflight$
DECLARE
    v_cancel regprocedure := to_regprocedure('public.cancel_p2p_trade(uuid,uuid,text)');
    v_resolver regprocedure := to_regprocedure('public.resolve_trade_dispute(uuid,text,uuid,uuid)');
    v_wrapper regprocedure := to_regprocedure('public.admin_resolve_trade_dispute_atomic(uuid,uuid,uuid,uuid,text,text)');
    v_definition text;
BEGIN
    IF v_cancel IS NULL OR v_resolver IS NULL OR v_wrapper IS NULL THEN
        RAISE EXCEPTION 'Canonical cancellation or atomic dispute RPC is missing';
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
        RAISE EXCEPTION 'Canonical cancel RPC ownership, search_path or grants are unsafe';
    END IF;

    IF pg_catalog.has_function_privilege('service_role',v_resolver,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_resolver,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_resolver,'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('postgres',v_resolver,'EXECUTE') THEN
        RAISE EXCEPTION 'Inner dispute resolver must be postgres-only';
    END IF;

    IF NOT pg_catalog.has_function_privilege('service_role',v_wrapper,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_wrapper,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_wrapper,'EXECUTE') THEN
        RAISE EXCEPTION 'Atomic dispute wrapper must be service-role only';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_index i
        JOIN pg_catalog.pg_class idx ON idx.oid=i.indexrelid
        JOIN pg_catalog.pg_class tbl ON tbl.oid=i.indrelid
        JOIN pg_catalog.pg_namespace n ON n.oid=tbl.relnamespace
        WHERE n.nspname='public'
          AND tbl.relname='disputes'
          AND idx.relname='disputes_one_open_per_trade_uidx'
          AND i.indisunique
          AND pg_catalog.strpos(
              pg_catalog.lower(pg_catalog.pg_get_expr(i.indpred,i.indrelid)),
              'open'
          ) > 0
          AND pg_catalog.strpos(
              pg_catalog.lower(pg_catalog.pg_get_expr(i.indpred,i.indrelid)),
              'trade_id'
          ) > 0
    ) THEN
        RAISE EXCEPTION 'Unique one-open-dispute-per-trade index is missing';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_cancel) INTO v_definition;
    IF pg_catalog.strpos(v_definition,'v_open_dispute_count INTEGER := 0')=0
       OR pg_catalog.strpos(v_definition,'SELECT COUNT(*)')=0
       OR pg_catalog.strpos(v_definition,'ADMIN_CANCEL_REQUIRES_SINGLE_OPEN_DISPUTE')=0
       OR pg_catalog.strpos(v_definition,'v_open_dispute_count <> 1')=0 THEN
        RAISE EXCEPTION 'Administrator paid/disputed cancellation is not guarded by exactly one open dispute';
    END IF;

    IF (
        SELECT count(*)
        FROM pg_catalog.pg_proc caller
        JOIN pg_catalog.pg_namespace n ON n.oid=caller.pronamespace
        WHERE n.nspname='public'
          AND caller.oid<>v_cancel
          AND position('public.cancel_p2p_trade(' in caller.prosrc)>0
    ) <> 1 OR NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc caller
        JOIN pg_catalog.pg_namespace n ON n.oid=caller.pronamespace
        WHERE n.nspname='public'
          AND caller.oid=v_resolver
          AND position('public.cancel_p2p_trade(' in caller.prosrc)>0
    ) THEN
        RAISE EXCEPTION 'Unexpected database caller of canonical cancellation RPC';
    END IF;
END;
$preflight$;
