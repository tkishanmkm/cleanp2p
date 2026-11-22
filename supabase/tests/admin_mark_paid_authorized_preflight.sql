-- Read-only preflight for the service-only admin mark-paid wrapper.
DO $preflight$
DECLARE
    v_wrapper regprocedure := to_regprocedure(
        'public.admin_mark_trade_paid_authorized(uuid,uuid,text,text)'
    );
    v_mark_paid regprocedure := to_regprocedure(
        'public.mark_p2p_trade_paid(uuid,uuid,text)'
    );
    v_active_admin regprocedure := to_regprocedure(
        'public.is_active_admin_identity(uuid)'
    );
    v_definition text;
BEGIN
    IF v_wrapper IS NULL OR v_mark_paid IS NULL OR v_active_admin IS NULL THEN
        RAISE EXCEPTION 'Admin wrapper or canonical mark-paid/admin predicate is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        WHERE p.oid=v_wrapper
          AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
          AND 'search_path=""'=ANY(coalesce(p.proconfig,ARRAY[]::text[]))
    ) OR NOT pg_catalog.has_function_privilege('service_role',v_wrapper,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_wrapper,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_wrapper,'EXECUTE')
       OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_proc p
            CROSS JOIN LATERAL pg_catalog.aclexplode(
                coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))
            ) acl
            WHERE p.oid=v_wrapper
              AND acl.grantee=0
              AND acl.privilege_type='EXECUTE'
       ) THEN
        RAISE EXCEPTION 'Admin mark-paid wrapper must be postgres-owned, empty-path and service-role-only';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid=v_mark_paid AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
          AND 'search_path=""'=ANY(coalesce(p.proconfig,ARRAY[]::text[]))
    ) OR NOT pg_catalog.has_function_privilege('service_role',v_mark_paid,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_mark_paid,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_mark_paid,'EXECUTE') THEN
        RAISE EXCEPTION 'Canonical participant mark-paid RPC lost its service-only contract';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid=v_active_admin AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
          AND 'search_path=""'=ANY(coalesce(p.proconfig,ARRAY[]::text[]))
    ) THEN
        RAISE EXCEPTION 'Active-admin predicate must remain postgres-owned SECURITY DEFINER with an empty search_path';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_wrapper) INTO v_definition;
    IF pg_catalog.strpos(v_definition,'auth.jwt() ->> ''role''')=0
       OR pg_catalog.strpos(v_definition,'public.is_active_admin_identity(p_actor_id)')=0
       OR pg_catalog.strpos(v_definition,'public.mark_p2p_trade_paid(')=0
       OR pg_catalog.strpos(v_definition,'ADMIN_MARKED_TRADE_PAID')=0
       OR pg_catalog.strpos(v_definition,'public.admin_audit_logs')=0
       OR pg_catalog.strpos(v_definition,'v_clean_reason')=0 THEN
        RAISE EXCEPTION 'Admin mark-paid wrapper is missing trusted server, active-admin, canonical transition or audit logic';
    END IF;
END;
$preflight$;
