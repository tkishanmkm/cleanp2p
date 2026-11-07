-- Read-only ACL, ownership, caller and search-path preflight.
DO $preflight$
DECLARE
    v_name text;
    v_helper regprocedure;
    v_ledger regprocedure := to_regprocedure(
        'public.record_platform_ledger_entry(text,text,numeric,text,uuid,text,text,text,text,text,jsonb)'
    );
    v_transfer regprocedure := to_regprocedure(
        'public.execute_internal_transfer(uuid,text,text,numeric,text)'
    );
    v_caller_count integer;
BEGIN
    FOREACH v_name IN ARRAY ARRAY[
        'admin_adjust_balance',
        'ensure_user_balance_wallet',
        'mark_gas_funded',
        'mark_swept',
        'record_platform_ledger_entry'
    ] LOOP
        FOR v_helper IN
            SELECT p.oid::regprocedure
            FROM pg_catalog.pg_proc p
            JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname='public' AND p.proname=v_name
        LOOP
            IF NOT EXISTS (
                SELECT 1
                FROM pg_catalog.pg_proc p
                WHERE p.oid=v_helper
                  AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
                  AND 'search_path=""' = ANY(coalesce(p.proconfig,ARRAY[]::text[]))
            ) THEN
                RAISE EXCEPTION 'Legacy helper % must be postgres-owned with an empty search_path', v_helper;
            END IF;

            IF pg_catalog.has_function_privilege('service_role',v_helper,'EXECUTE')
               OR pg_catalog.has_function_privilege('anon',v_helper,'EXECUTE')
               OR pg_catalog.has_function_privilege('authenticated',v_helper,'EXECUTE')
               OR pg_catalog.has_function_privilege('supabase_auth_admin',v_helper,'EXECUTE')
               OR EXISTS (
                    SELECT 1
                    FROM pg_catalog.pg_proc p
                    CROSS JOIN LATERAL pg_catalog.aclexplode(
                        coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))
                    ) acl
                    WHERE p.oid=v_helper
                      AND acl.grantee=0
                      AND acl.privilege_type='EXECUTE'
               )
               OR NOT pg_catalog.has_function_privilege('postgres',v_helper,'EXECUTE') THEN
                RAISE EXCEPTION 'Legacy helper % execute grants are not postgres-only', v_helper;
            END IF;
        END LOOP;
    END LOOP;

    IF v_ledger IS NULL OR v_transfer IS NULL THEN
        RAISE EXCEPTION 'Canonical ledger/transfer RPC is missing';
    END IF;

    SELECT count(*) INTO v_caller_count
    FROM pg_catalog.pg_proc caller
    JOIN pg_catalog.pg_namespace n ON n.oid=caller.pronamespace
    WHERE n.nspname='public'
      AND position('record_platform_ledger_entry(' in caller.prosrc)>0;

    IF v_caller_count <> 2 OR EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc caller
        JOIN pg_catalog.pg_namespace n ON n.oid=caller.pronamespace
        WHERE n.nspname='public'
          AND position('record_platform_ledger_entry(' in caller.prosrc)>0
          AND (
              caller.prosecdef IS NOT TRUE
              OR pg_catalog.pg_get_userbyid(caller.proowner)<>'postgres'
          )
    ) OR pg_catalog.has_function_privilege('service_role',v_ledger,'EXECUTE') THEN
        RAISE EXCEPTION 'Only the two postgres-owned withdrawal settlement RPCs may invoke the ledger helper';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        WHERE p.oid=v_transfer
          AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
          AND 'search_path=""' = ANY(coalesce(p.proconfig,ARRAY[]::text[]))
    ) OR NOT pg_catalog.has_function_privilege('service_role',v_transfer,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_transfer,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_transfer,'EXECUTE')
       OR pg_catalog.has_function_privilege('supabase_auth_admin',v_transfer,'EXECUTE')
    THEN
        RAISE EXCEPTION 'Canonical internal transfer must remain postgres-owned, empty-path and service-role only';
    END IF;
END;
$preflight$;
