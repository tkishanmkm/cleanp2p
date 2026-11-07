-- Read-only post-apply preflight for legacy escrow RPC retirement.
DO $preflight$
DECLARE
    v_legacy regprocedure;
    v_active regprocedure;
BEGIN
    FOREACH v_legacy IN ARRAY ARRAY[
        to_regprocedure('public.cancel_trade_and_release_escrow(uuid,text)'),
        to_regprocedure('public.refund_trade_escrow_to_seller(uuid,uuid,text)'),
        to_regprocedure('public.complete_trade(uuid)')
    ]::regprocedure[] LOOP
        IF v_legacy IS NULL OR NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc p
            WHERE p.oid=v_legacy
              AND p.prosecdef IS TRUE
              AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
              AND 'search_path=""' = ANY(coalesce(p.proconfig,ARRAY[]::text[]))
        ) THEN
            RAISE EXCEPTION 'Retired legacy escrow function % is missing or has unsafe ownership/path',v_legacy;
        END IF;

        IF pg_catalog.has_function_privilege('anon',v_legacy,'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated',v_legacy,'EXECUTE')
           OR pg_catalog.has_function_privilege('service_role',v_legacy,'EXECUTE')
           OR pg_catalog.has_function_privilege('supabase_auth_admin',v_legacy,'EXECUTE')
           OR EXISTS (
                SELECT 1
                FROM pg_catalog.pg_proc p
                CROSS JOIN LATERAL pg_catalog.aclexplode(
                    coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))
                ) acl
                WHERE p.oid=v_legacy
                  AND acl.grantee=0
                  AND acl.privilege_type='EXECUTE'
           )
           OR NOT pg_catalog.has_function_privilege('postgres',v_legacy,'EXECUTE') THEN
            RAISE EXCEPTION 'Legacy escrow function % remains executable outside postgres',v_legacy;
        END IF;
    END LOOP;

    -- The atomic admin dispute wrapper is the only public service entry point
    -- for irreversible admin settlement. Its inner resolver is postgres-only.
    v_active := to_regprocedure(
        'public.admin_resolve_trade_dispute_atomic(uuid,uuid,uuid,uuid,text,text)'
    );
    IF v_active IS NULL
       OR NOT pg_catalog.has_function_privilege('service_role',v_active,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_active,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_active,'EXECUTE')
       OR NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc p
            WHERE p.oid=v_active
              AND p.prosecdef IS TRUE
              AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
              AND 'search_path=""' = ANY(coalesce(p.proconfig,ARRAY[]::text[]))
       ) THEN
        RAISE EXCEPTION 'Atomic admin dispute wrapper is missing or has incorrect access/security settings';
    END IF;

    v_active := to_regprocedure('public.resolve_trade_dispute(uuid,text,uuid,uuid)');
    IF v_active IS NULL
       OR pg_catalog.has_function_privilege('service_role',v_active,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_active,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_active,'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('postgres',v_active,'EXECUTE') THEN
        RAISE EXCEPTION 'Inner dispute resolver is not restricted to postgres';
    END IF;

    FOREACH v_active IN ARRAY ARRAY[
        to_regprocedure('public.release_trade_escrow(uuid,uuid)'),
        to_regprocedure('public.cancel_p2p_trade(uuid,uuid,text)')
    ]::regprocedure[] LOOP
        IF v_active IS NULL
           OR NOT pg_catalog.has_function_privilege('service_role',v_active,'EXECUTE')
           OR pg_catalog.has_function_privilege('anon',v_active,'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated',v_active,'EXECUTE') THEN
            RAISE EXCEPTION 'Canonical release/cancel RPC % lost its server-only access',v_active;
        END IF;
    END LOOP;

    IF pg_catalog.has_function_privilege(
        'service_role','public.admin_resolve_dispute(uuid,uuid,text,text)','EXECUTE'
    ) OR pg_catalog.has_function_privilege(
        'service_role','public.admin_release_escrow(character varying,uuid,text)','EXECUTE'
    ) THEN
        RAISE EXCEPTION 'A legacy admin escrow RPC remains directly executable by service_role';
    END IF;
END;
$preflight$;
