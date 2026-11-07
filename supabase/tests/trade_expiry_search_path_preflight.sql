-- Read-only preflight for secure trade-expiry worker functions.
DO $preflight$
DECLARE
    v_function regprocedure;
BEGIN
    FOREACH v_function IN ARRAY ARRAY[
        to_regprocedure('public.cancel_expired_p2p_trades()'),
        to_regprocedure('public.expire_p2p_trade(uuid)')
    ]::regprocedure[] LOOP
        IF v_function IS NULL OR NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc p
            WHERE p.oid=v_function
              AND p.prosecdef IS TRUE
              AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
              AND 'search_path=""' = ANY(coalesce(p.proconfig,ARRAY[]::text[]))
        ) THEN
            RAISE EXCEPTION 'Expiry function % must be postgres-owned SECURITY DEFINER with an empty search_path',v_function;
        END IF;

        IF NOT pg_catalog.has_function_privilege('service_role',v_function,'EXECUTE')
           OR pg_catalog.has_function_privilege('anon',v_function,'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated',v_function,'EXECUTE') THEN
            RAISE EXCEPTION 'Expiry function % must remain service-role-only',v_function;
        END IF;
    END LOOP;

    IF pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(
            'public.cancel_expired_p2p_trades()'::regprocedure
        ),
        'public.expire_p2p_trade('
    ) = 0 THEN
        RAISE EXCEPTION 'Batch expiry function lost its canonical per-trade RPC call';
    END IF;
END;
$preflight$;
