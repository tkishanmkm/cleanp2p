-- Read-only preflight for retirement of the legacy Didit KYC state writer.
DO $preflight$
DECLARE
    v_legacy regprocedure := to_regprocedure(
        'public.sync_didit_kyc_status(uuid,text,text,jsonb)'
    );
    v_rpc regprocedure;
BEGIN
    IF v_legacy IS NULL OR NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        WHERE p.oid=v_legacy
          AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
          AND 'search_path=""'=ANY(coalesce(p.proconfig,ARRAY[]::text[]))
    ) THEN
        RAISE EXCEPTION 'Legacy Didit writer must be retained only as a postgres-owned empty-path function';
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
        RAISE EXCEPTION 'Legacy Didit writer direct execute privileges are not postgres-only';
    END IF;

    FOREACH v_rpc IN ARRAY ARRAY[
        to_regprocedure('public.claim_didit_webhook_event(text,text,text)'),
        to_regprocedure('public.finish_didit_webhook_event(text,text,text,uuid,boolean)'),
        to_regprocedure('public.apply_didit_webhook_state(uuid,text,text,text,uuid,jsonb,public.kyc_status_enum,jsonb,jsonb)')
    ]::regprocedure[] LOOP
        IF v_rpc IS NULL OR NOT EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc p
            WHERE p.oid=v_rpc
              AND p.prosecdef IS TRUE
              AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
              AND 'search_path=""'=ANY(coalesce(p.proconfig,ARRAY[]::text[]))
        ) OR NOT pg_catalog.has_function_privilege('service_role',v_rpc,'EXECUTE')
          OR pg_catalog.has_function_privilege('anon',v_rpc,'EXECUTE')
          OR pg_catalog.has_function_privilege('authenticated',v_rpc,'EXECUTE')
          OR pg_catalog.has_function_privilege('supabase_auth_admin',v_rpc,'EXECUTE') THEN
            RAISE EXCEPTION 'Canonical signed-event Didit RPC % lost its service-only secure contract',v_rpc;
        END IF;
    END LOOP;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc caller
        JOIN pg_catalog.pg_namespace n ON n.oid=caller.pronamespace
        WHERE n.nspname='public'
          AND caller.oid<>v_legacy
          AND position('sync_didit_kyc_status(' in caller.prosrc)>0
    ) THEN
        RAISE EXCEPTION 'An installed public database function still invokes the legacy Didit writer';
    END IF;
END;
$preflight$;
