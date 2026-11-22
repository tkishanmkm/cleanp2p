-- Read-only ACL and SECURITY DEFINER path preflight for generic nonce helpers.
DO $preflight$
DECLARE
    v_integer regprocedure := to_regprocedure('public.allocate_hot_wallet_nonce(integer)');
    v_network regprocedure := to_regprocedure('public.allocate_hot_wallet_nonce(text,text,bigint)');
    v_withdrawal regprocedure := to_regprocedure(
        'public.allocate_onchain_withdrawal_nonce(uuid,text,text,text,bigint)'
    );
    v_helper regprocedure;
    v_definition text;
BEGIN
    FOREACH v_helper IN ARRAY ARRAY[v_integer, v_network]::regprocedure[] LOOP
        IF v_helper IS NULL THEN
            RAISE EXCEPTION 'Generic hot-wallet nonce helper overload is missing';
        END IF;

        IF NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc p
            WHERE p.oid = v_helper
              AND p.prosecdef IS TRUE
              AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
              AND 'search_path=""' = ANY(coalesce(p.proconfig, ARRAY[]::text[]))
        ) THEN
            RAISE EXCEPTION 'Nonce helper % must be postgres-owned SECURITY DEFINER with an empty search_path', v_helper;
        END IF;

        IF pg_catalog.has_function_privilege('anon', v_helper, 'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated', v_helper, 'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role', v_helper, 'EXECUTE')
           OR pg_catalog.has_function_privilege('supabase_auth_admin', v_helper, 'EXECUTE')
           OR EXISTS (
                SELECT 1
                FROM pg_catalog.pg_proc p
                CROSS JOIN LATERAL pg_catalog.aclexplode(
                    coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
                ) acl
                WHERE p.oid = v_helper
                  AND acl.grantee = 0
                  AND acl.privilege_type = 'EXECUTE'
           ) THEN
            RAISE EXCEPTION 'Nonce helper % remains executable by an API/runtime role', v_helper;
        END IF;

        IF NOT pg_catalog.has_function_privilege('postgres', v_helper, 'EXECUTE') THEN
            RAISE EXCEPTION 'Postgres internal execution grant is missing for %', v_helper;
        END IF;
    END LOOP;

    IF v_withdrawal IS NULL
       OR NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc p
            WHERE p.oid = v_withdrawal
              AND p.prosecdef IS TRUE
              AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
              AND 'search_path=""' = ANY(coalesce(p.proconfig, ARRAY[]::text[]))
       ) THEN
        RAISE EXCEPTION 'Operation-bound withdrawal allocator must retain its postgres SECURITY DEFINER ownership';
    END IF;

    v_definition := pg_catalog.pg_get_functiondef(v_withdrawal);
    IF pg_catalog.strpos(v_definition, 'public.allocate_hot_wallet_nonce(') = 0
       OR NOT pg_catalog.has_function_privilege('service_role', v_withdrawal, 'EXECUTE') THEN
        RAISE EXCEPTION 'Operation-bound withdrawal allocator no longer provides the authorized internal call path';
    END IF;
END;
$preflight$;
