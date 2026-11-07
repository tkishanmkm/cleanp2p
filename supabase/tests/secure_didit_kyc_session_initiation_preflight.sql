-- Read-only preflight for secure Didit session initiation.
DO $preflight$
DECLARE
    v_secure regprocedure := to_regprocedure(
        'public.initiate_didit_kyc_secure(uuid,text,uuid)'
    );
    v_legacy regprocedure := to_regprocedure('public.initiate_didit_kyc(uuid,text)');
    v_timeout regprocedure := to_regprocedure('public.check_kyc_review_timeout(uuid)');
    v_definition text;
    v_callers text[];
BEGIN
    IF v_secure IS NULL OR v_legacy IS NULL OR v_timeout IS NULL THEN
        RAISE EXCEPTION 'Secure/legacy Didit initiation dependencies are missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid=v_secure AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
          AND 'search_path=""'=ANY(coalesce(p.proconfig,ARRAY[]::text[]))
    ) OR NOT pg_catalog.has_function_privilege('service_role',v_secure,'EXECUTE')
      OR pg_catalog.has_function_privilege('anon',v_secure,'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated',v_secure,'EXECUTE')
      OR pg_catalog.has_function_privilege('supabase_auth_admin',v_secure,'EXECUTE')
      OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        CROSS JOIN LATERAL pg_catalog.aclexplode(
          coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))
        ) acl
        WHERE p.oid=v_secure AND acl.grantee=0 AND acl.privilege_type='EXECUTE'
      ) THEN
        RAISE EXCEPTION 'Secure KYC initiation must be postgres-owned empty-path and service-role-only';
    END IF;

    IF pg_catalog.has_function_privilege('service_role',v_legacy,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_legacy,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_legacy,'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('postgres',v_legacy,'EXECUTE') THEN
        RAISE EXCEPTION 'Legacy KYC initiation must remain postgres-internal';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid=v_timeout AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
          AND 'search_path=""'=ANY(coalesce(p.proconfig,ARRAY[]::text[]))
    ) OR pg_catalog.has_function_privilege('service_role',v_timeout,'EXECUTE')
      OR pg_catalog.has_function_privilege('authenticated',v_timeout,'EXECUTE')
      OR NOT pg_catalog.has_function_privilege('postgres',v_timeout,'EXECUTE') THEN
        RAISE EXCEPTION 'KYC timeout helper must be postgres-internal with an empty search_path';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_secure) INTO v_definition;
    IF pg_catalog.strpos(v_definition,'auth.jwt() ->> ''role''')=0
       OR pg_catalog.strpos(v_definition,'public.is_active_admin_identity(p_actor_id)')=0
       OR pg_catalog.strpos(v_definition,'FOR UPDATE')=0
       OR pg_catalog.strpos(v_definition,'pg_advisory_xact_lock')=0
       OR pg_catalog.strpos(v_definition,'account_restricted')=0
       OR pg_catalog.strpos(v_definition,'interval ''24 hours''')=0
       OR pg_catalog.strpos(v_definition,'v_attempts >= 3')=0
       OR pg_catalog.strpos(v_definition,'session_already_registered')=0
       OR pg_catalog.strpos(v_definition,'INSERT INTO public.kyc_verifications')=0 THEN
        RAISE EXCEPTION 'Secure KYC initiation lacks trusted actor, serialization, retry or session-registration guards';
    END IF;

    SELECT coalesce(array_agg(caller.proname ORDER BY caller.proname),ARRAY[]::text[])
      INTO v_callers
    FROM pg_catalog.pg_proc caller
    JOIN pg_catalog.pg_namespace n ON n.oid=caller.pronamespace
    WHERE n.nspname='public'
      AND caller.oid<>v_timeout
      AND position('check_kyc_review_timeout(' in caller.prosrc)>0;

    IF v_callers IS DISTINCT FROM ARRAY[
        'initiate_didit_kyc',
        'initiate_didit_kyc_secure'
    ]::text[] THEN
        RAISE EXCEPTION 'Unexpected KYC timeout helper caller graph: %',v_callers;
    END IF;
END;
$preflight$;
