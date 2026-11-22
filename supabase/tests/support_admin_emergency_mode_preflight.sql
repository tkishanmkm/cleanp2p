-- Read-only structural and privilege preflight for support-admin emergency mode.
DO $preflight$
DECLARE
    v_table regclass;
    v_rpc regprocedure;
    v_required_functions regprocedure[] := ARRAY[
        to_regprocedure('public.is_active_full_admin_actor(uuid)'),
        to_regprocedure('public.configure_support_admin(uuid,uuid,boolean,integer)'),
        to_regprocedure('public.activate_support_admin_emergency(uuid,timestamptz)'),
        to_regprocedure('public.revoke_support_admin_emergency(uuid,uuid,uuid,text)')
    ];
    v_grant regclass := to_regclass('public.support_admin_grants');
    v_sessions regclass := to_regclass('public.support_admin_emergency_sessions');
    v_activity regclass := to_regclass('public.support_admin_activity');
    v_profile_definition text;
    v_activate_definition text;
BEGIN
    IF v_grant IS NULL OR v_sessions IS NULL OR v_activity IS NULL THEN
        RAISE EXCEPTION 'Support-admin tables are missing';
    END IF;

    FOREACH v_table IN ARRAY ARRAY[v_grant,v_sessions,v_activity] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_class c
            WHERE c.oid=v_table AND c.relrowsecurity IS TRUE
        ) THEN
            RAISE EXCEPTION 'RLS must be enabled on support-admin table %',v_table;
        END IF;

        IF pg_catalog.has_table_privilege('anon',v_table,'SELECT')
           OR pg_catalog.has_table_privilege('anon',v_table,'INSERT')
           OR pg_catalog.has_table_privilege('anon',v_table,'UPDATE')
           OR pg_catalog.has_table_privilege('anon',v_table,'DELETE')
           OR pg_catalog.has_table_privilege('authenticated',v_table,'SELECT')
           OR pg_catalog.has_table_privilege('authenticated',v_table,'INSERT')
           OR pg_catalog.has_table_privilege('authenticated',v_table,'UPDATE')
           OR pg_catalog.has_table_privilege('authenticated',v_table,'DELETE')
           OR pg_catalog.has_table_privilege('supabase_auth_admin',v_table,'SELECT')
           OR pg_catalog.has_table_privilege('supabase_auth_admin',v_table,'INSERT')
           OR pg_catalog.has_table_privilege('supabase_auth_admin',v_table,'UPDATE')
           OR pg_catalog.has_table_privilege('supabase_auth_admin',v_table,'DELETE') THEN
            RAISE EXCEPTION 'A browser/Auth role retains direct access to support-admin table %',v_table;
        END IF;

        IF NOT pg_catalog.has_table_privilege('service_role',v_table,'SELECT')
           OR NOT pg_catalog.has_table_privilege('service_role',v_table,'INSERT')
           OR NOT pg_catalog.has_table_privilege('service_role',v_table,'UPDATE')
           OR NOT pg_catalog.has_table_privilege('service_role',v_table,'DELETE') THEN
            RAISE EXCEPTION 'service_role is missing required support-admin table access on %',v_table;
        END IF;

        IF EXISTS (
            SELECT 1
            FROM pg_catalog.pg_policies p
            WHERE p.schemaname='public'
              AND p.tablename=pg_catalog.split_part(v_table::text,'.',2)
              AND p.roles @> ARRAY['public']::name[]
        ) THEN
            RAISE EXCEPTION 'Support-admin table % has an unexpected PUBLIC RLS policy',v_table;
        END IF;
    END LOOP;

    FOREACH v_rpc IN ARRAY v_required_functions LOOP
        IF v_rpc IS NULL OR NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc p
            WHERE p.oid=v_rpc
              AND p.prosecdef IS TRUE
              AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
              AND 'search_path=""'=ANY(coalesce(p.proconfig,ARRAY[]::text[]))
        ) THEN
            RAISE EXCEPTION 'Support-admin RPC % must be postgres-owned SECURITY DEFINER with an empty search_path',v_rpc;
        END IF;

        IF pg_catalog.has_function_privilege('anon',v_rpc,'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated',v_rpc,'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('service_role',v_rpc,'EXECUTE')
           OR NOT pg_catalog.has_function_privilege('postgres',v_rpc,'EXECUTE')
           OR EXISTS (
                SELECT 1
                FROM pg_catalog.pg_proc p
                CROSS JOIN LATERAL pg_catalog.aclexplode(
                    coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))
                ) acl
                WHERE p.oid=v_rpc
                  AND acl.grantee=0
                  AND acl.privilege_type='EXECUTE'
           ) THEN
            RAISE EXCEPTION 'Support-admin RPC % must be service-role/postgres only',v_rpc;
        END IF;
    END LOOP;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid='public.check_is_admin(uuid,uuid)'::regprocedure
          AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
          AND 'search_path=""'=ANY(coalesce(p.proconfig,ARRAY[]::text[]))
          AND pg_catalog.pg_has_role(current_user,p.proowner,'USAGE')
    ) THEN
        RAISE EXCEPTION 'Canonical check_is_admin dependency is missing or unsafe';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(
      'public.is_active_full_admin_actor(uuid)'::regprocedure
    ) INTO v_profile_definition;
    IF pg_catalog.strpos(v_profile_definition,'p.account_status')=0
       OR pg_catalog.strpos(v_profile_definition,'p.is_banned')=0
       OR pg_catalog.strpos(v_profile_definition,'p.is_suspended')=0
       OR pg_catalog.strpos(v_profile_definition,'p.is_restricted')=0
       OR pg_catalog.strpos(v_profile_definition,'p.is_emergency_frozen')=0
       OR pg_catalog.strpos(v_profile_definition,'public.app_admins')=0 THEN
        RAISE EXCEPTION 'Full-admin actor helper is missing account-state or durable admin checks';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(
      'public.activate_support_admin_emergency(uuid,timestamptz)'::regprocedure
    ) INTO v_activate_definition;
    IF pg_catalog.strpos(v_activate_definition,'public.check_is_admin(p_support_admin_id, NULL)')=0
       OR pg_catalog.strpos(v_activate_definition,'v_grant.emergency_uses_remaining < 1')=0
       OR pg_catalog.strpos(v_activate_definition,'p_two_factor_verified_at')=0
       OR pg_catalog.strpos(v_activate_definition,'interval ''3 hours''')=0 THEN
        RAISE EXCEPTION 'Emergency activation must reject full admins and require 2FA, available use and a bounded session';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_index i
        WHERE i.indrelid=v_sessions
          AND i.indisunique
          AND i.indisvalid
          AND pg_catalog.pg_get_indexdef(i.indexrelid) LIKE '%support_admin_id%'
          AND pg_catalog.pg_get_indexdef(i.indexrelid) LIKE '%WHERE (revoked_at IS NULL)%'
    ) THEN
        RAISE EXCEPTION 'One-active-support-session unique index is missing';
    END IF;
END;
$preflight$;
