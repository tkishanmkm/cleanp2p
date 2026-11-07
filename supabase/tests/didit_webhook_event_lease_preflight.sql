-- Read-only structural, lease, ownership and ACL preflight for Didit webhooks.
DO $preflight$
DECLARE
    v_events regclass := to_regclass('public.kyc_webhook_events');
    v_claim regprocedure := to_regprocedure('public.claim_didit_webhook_event(text,text,text)');
    v_finish regprocedure := to_regprocedure('public.finish_didit_webhook_event(text,text,text,uuid,boolean)');
    v_apply regprocedure := to_regprocedure(
        'public.apply_didit_webhook_state(uuid,text,text,text,uuid,jsonb,public.kyc_status_enum,jsonb,jsonb)'
    );
    v_function regprocedure;
    v_sequence regclass;
    v_definition text;
BEGIN
    IF v_events IS NULL OR v_claim IS NULL OR v_finish IS NULL OR v_apply IS NULL THEN
        RAISE EXCEPTION 'Didit webhook event table or RPC signatures are missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_class c
        WHERE c.oid=v_events
          AND c.relrowsecurity IS TRUE
          AND c.relforcerowsecurity IS FALSE
          AND pg_catalog.pg_get_userbyid(c.relowner)='postgres'
    ) THEN
        RAISE EXCEPTION 'Didit event table must be postgres-owned with RLS enabled and FORCE RLS disabled';
    END IF;

    IF pg_catalog.has_table_privilege('anon',v_events,'SELECT')
       OR pg_catalog.has_table_privilege('anon',v_events,'INSERT')
       OR pg_catalog.has_table_privilege('anon',v_events,'UPDATE')
       OR pg_catalog.has_table_privilege('anon',v_events,'DELETE')
       OR pg_catalog.has_table_privilege('authenticated',v_events,'SELECT')
       OR pg_catalog.has_table_privilege('authenticated',v_events,'INSERT')
       OR pg_catalog.has_table_privilege('authenticated',v_events,'UPDATE')
       OR pg_catalog.has_table_privilege('authenticated',v_events,'DELETE')
       OR pg_catalog.has_table_privilege('service_role',v_events,'SELECT')
       OR pg_catalog.has_table_privilege('service_role',v_events,'INSERT')
       OR pg_catalog.has_table_privilege('service_role',v_events,'UPDATE')
       OR pg_catalog.has_table_privilege('service_role',v_events,'DELETE')
       OR pg_catalog.has_table_privilege('supabase_auth_admin',v_events,'SELECT')
       OR pg_catalog.has_table_privilege('supabase_auth_admin',v_events,'INSERT')
       OR pg_catalog.has_table_privilege('supabase_auth_admin',v_events,'UPDATE')
       OR pg_catalog.has_table_privilege('supabase_auth_admin',v_events,'DELETE')
       OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class c
            CROSS JOIN LATERAL pg_catalog.aclexplode(
                coalesce(c.relacl,pg_catalog.acldefault('r',c.relowner))
            ) acl
            WHERE c.oid=v_events
              AND acl.grantee=0
              AND acl.privilege_type IN ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')
       ) THEN
        RAISE EXCEPTION 'Didit event table must not be directly accessible by API/Auth roles, including service_role';
    END IF;

    IF EXISTS (
        SELECT 1 FROM pg_catalog.pg_policies p
        WHERE p.schemaname='public' AND p.tablename='kyc_webhook_events'
    ) THEN
        RAISE EXCEPTION 'Private Didit event table must not have direct RLS policies';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='kyc_verifications'
          AND column_name='decision' AND data_type='jsonb'
          AND is_nullable='NO'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema='public' AND table_name='kyc_verifications'
          AND column_name='vendor_data' AND data_type='jsonb'
          AND is_nullable='NO'
    ) THEN
        RAISE EXCEPTION 'KYC verification decision/vendor JSONB columns are missing or nullable';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_enum e
        JOIN pg_catalog.pg_type t ON t.oid=e.enumtypid
        JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
        WHERE n.nspname='public' AND t.typname='kyc_status_enum'
          AND e.enumlabel='RESUBMIT_REQUIRED'
    ) THEN
        RAISE EXCEPTION 'KYC enum lifecycle status RESUBMIT_REQUIRED is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_enum e
        JOIN pg_catalog.pg_type t ON t.oid=e.enumtypid
        JOIN pg_catalog.pg_namespace n ON n.oid=t.typnamespace
        WHERE n.nspname='public' AND t.typname='kyc_status_enum'
          AND e.enumlabel='ABANDONED'
    ) THEN
        RAISE EXCEPTION 'KYC enum lifecycle status ABANDONED is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint c
        WHERE c.conrelid=v_events
          AND c.conname='kyc_webhook_events_session_event_key'
          AND c.contype='u' AND c.convalidated IS TRUE
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint c
        WHERE c.conrelid=v_events
          AND c.conname='kyc_webhook_events_digest_check'
          AND c.contype='c' AND c.convalidated IS TRUE
    ) OR NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_constraint c
        WHERE c.conrelid=v_events
          AND c.conname='kyc_webhook_events_lease_check'
          AND c.contype='c' AND c.convalidated IS TRUE
    ) THEN
        RAISE EXCEPTION 'Didit event uniqueness/digest/lease constraints are missing or unvalidated';
    END IF;

    FOREACH v_function IN ARRAY ARRAY[v_claim,v_finish,v_apply] LOOP
        IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_proc p
            WHERE p.oid=v_function AND p.prosecdef IS TRUE
              AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
              AND 'search_path=""'=ANY(coalesce(p.proconfig,ARRAY[]::text[]))
        ) THEN
            RAISE EXCEPTION 'Didit RPC % must be postgres-owned SECURITY DEFINER with an empty search_path',v_function;
        END IF;

        IF NOT pg_catalog.has_function_privilege('service_role',v_function,'EXECUTE')
           OR pg_catalog.has_function_privilege('anon',v_function,'EXECUTE')
           OR pg_catalog.has_function_privilege('authenticated',v_function,'EXECUTE')
           OR pg_catalog.has_function_privilege('supabase_auth_admin',v_function,'EXECUTE')
           OR EXISTS (
                SELECT 1
                FROM pg_catalog.pg_proc p
                CROSS JOIN LATERAL pg_catalog.aclexplode(
                    coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))
                ) acl
                WHERE p.oid=v_function
                  AND acl.grantee=0
                  AND acl.privilege_type='EXECUTE'
           ) THEN
            RAISE EXCEPTION 'Didit RPC % must be service-role-only',v_function;
        END IF;
    END LOOP;

    SELECT pg_catalog.pg_get_functiondef(v_claim) INTO v_definition;
    IF pg_catalog.strpos(v_definition,'pg_advisory_xact_lock')=0
       OR pg_catalog.strpos(v_definition,'payload_digest')=0
       OR pg_catalog.strpos(v_definition,'''duplicate''')=0
       OR pg_catalog.strpos(v_definition,'''conflict''')=0
       OR pg_catalog.strpos(v_definition,'''busy''')=0
       OR pg_catalog.strpos(v_definition,'''claimed''')=0 THEN
        RAISE EXCEPTION 'Didit claim RPC is missing digest-bound idempotency and concurrent lease responses';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_finish) INTO v_definition;
    IF pg_catalog.strpos(v_definition,'p_lease_token')=0
       OR pg_catalog.strpos(v_definition,'p_payload_digest')=0
       OR pg_catalog.strpos(v_definition,'DELETE FROM public.kyc_webhook_events')=0
       OR pg_catalog.strpos(v_definition,'UPDATE public.kyc_webhook_events')=0 THEN
        RAISE EXCEPTION 'Didit event finalizer is not fenced to the original lease/digest';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_apply) INTO v_definition;
    IF pg_catalog.strpos(v_definition,'p_lease_token')=0
       OR pg_catalog.strpos(v_definition,'p_payload_digest')=0
       OR pg_catalog.strpos(v_definition,'p_session_id')=0
       OR pg_catalog.strpos(v_definition,'p_user_id')=0
       OR pg_catalog.strpos(v_definition,'public.profiles')=0
       OR pg_catalog.strpos(v_definition,'public.kyc_verifications')=0
       OR pg_catalog.strpos(v_definition,'UPDATE public.kyc_webhook_events')=0
       OR pg_catalog.strpos(v_definition,'jsonb_object_keys(p_profile_patch)')=0 THEN
        RAISE EXCEPTION 'Didit state applier is missing lease/session/user binding, field allowlist or atomic event finalization';
    END IF;

    v_sequence := pg_catalog.pg_get_serial_sequence('public.kyc_webhook_events','id')::regclass;
    IF v_sequence IS NOT NULL AND (
        pg_catalog.has_sequence_privilege('anon',v_sequence,'USAGE')
        OR pg_catalog.has_sequence_privilege('authenticated',v_sequence,'USAGE')
        OR pg_catalog.has_sequence_privilege('service_role',v_sequence,'USAGE')
        OR pg_catalog.has_sequence_privilege('supabase_auth_admin',v_sequence,'USAGE')
        OR EXISTS (
            SELECT 1
            FROM pg_catalog.pg_class c
            CROSS JOIN LATERAL pg_catalog.aclexplode(
                coalesce(c.relacl,pg_catalog.acldefault('S',c.relowner))
            ) acl
            WHERE c.oid=v_sequence
              AND acl.grantee=0
              AND acl.privilege_type IN ('USAGE','SELECT','UPDATE')
        )
    ) THEN
        RAISE EXCEPTION 'Didit event identity sequence must remain private to its postgres-owned functions';
    END IF;
END;
$preflight$;
