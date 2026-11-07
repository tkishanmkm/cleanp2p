-- Read-only structural and grant preflight for the hardened sweep RPCs.
DO $preflight$
DECLARE
    v_status regprocedure := to_regprocedure(
        'public.update_sweep_operation_status(uuid,text,text,text,text,numeric,text,integer)'
    );
    v_cleanup regprocedure := to_regprocedure(
        'public.verify_and_lock_pre_broadcast_cleanup(uuid,text)'
    );
    v_legacy regprocedure := to_regprocedure(
        'public.initialize_resource_delegation(uuid,text,text,text,bigint,bigint)'
    );
    v_status_def text;
    v_cleanup_def text;
    v_legacy_def text;
BEGIN
    IF v_status IS NULL OR v_cleanup IS NULL OR v_legacy IS NULL THEN
        RAISE EXCEPTION 'A required sweep/delegation RPC is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid = v_status AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
          AND 'search_path=""' = ANY(coalesce(p.proconfig, ARRAY[]::text[]))
    ) OR NOT pg_catalog.has_function_privilege('service_role', v_status, 'EXECUTE') THEN
        RAISE EXCEPTION 'Sweep status RPC security owner, path or service grant is incorrect';
    END IF;

    IF pg_catalog.has_function_privilege('anon', v_status, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_status, 'EXECUTE')
       OR pg_catalog.has_function_privilege('supabase_auth_admin', v_status, 'EXECUTE') THEN
        RAISE EXCEPTION 'Browser role can execute sweep status RPC';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid = v_cleanup AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
          AND 'search_path=""' = ANY(coalesce(p.proconfig, ARRAY[]::text[]))
    ) OR NOT pg_catalog.has_function_privilege('service_role', v_cleanup, 'EXECUTE') THEN
        RAISE EXCEPTION 'Pre-broadcast cleanup RPC security owner, path or service grant is incorrect';
    END IF;

    IF pg_catalog.has_function_privilege('anon', v_cleanup, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_cleanup, 'EXECUTE')
       OR pg_catalog.has_function_privilege('supabase_auth_admin', v_cleanup, 'EXECUTE') THEN
        RAISE EXCEPTION 'Browser role can execute pre-broadcast cleanup RPC';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid = v_legacy AND p.prosecdef IS TRUE
          AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
          AND 'search_path=""' = ANY(coalesce(p.proconfig, ARRAY[]::text[]))
    ) OR pg_catalog.has_function_privilege('service_role', v_legacy, 'EXECUTE')
       OR pg_catalog.has_function_privilege('anon', v_legacy, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_legacy, 'EXECUTE') THEN
        RAISE EXCEPTION 'Legacy delegation initializer remains directly executable by an application role';
    END IF;

    IF NOT pg_catalog.has_function_privilege('postgres', v_legacy, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege(
            'service_role',
            'public.claim_or_initialize_resource_delegation(uuid,text,text,text,bigint,bigint)',
            'EXECUTE'
       ) THEN
        RAISE EXCEPTION 'Postgres internal compatibility or current delegation RPC grant is missing';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_status) INTO v_status_def;
    IF pg_catalog.strpos(v_status_def, 'lease_expires_at <= v_now') = 0
       OR pg_catalog.strpos(v_status_def, 'WHERE id = p_sweep_id') = 0
       OR pg_catalog.strpos(v_status_def, 'worker_id = p_worker_id') = 0
       OR pg_catalog.strpos(v_status_def, 'NONCED_SWEEP_CANNOT_FAIL') = 0
       OR pg_catalog.strpos(v_status_def, 'READY_TO_BROADCAST') = 0
       OR pg_catalog.strpos(v_status_def, 'GET DIAGNOSTICS v_rows = ROW_COUNT') = 0 THEN
        RAISE EXCEPTION 'Sweep transition RPC is missing lease, state, nonce or CAS safeguards';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_cleanup) INTO v_cleanup_def;
    IF pg_catalog.strpos(v_cleanup_def, 'lease_expires_at <= v_now') = 0
       OR pg_catalog.strpos(v_cleanup_def, 'nonce IS NOT NULL') = 0
       OR pg_catalog.strpos(v_cleanup_def, 'signed_tx_hex') = 0
       OR pg_catalog.strpos(v_cleanup_def, 'sweep_tx_hash') = 0
       OR pg_catalog.strpos(v_cleanup_def, 'DELEGATING') = 0
       OR pg_catalog.strpos(v_cleanup_def, 'DELEGATED') = 0 THEN
        RAISE EXCEPTION 'Pre-broadcast cleanup is missing active lease or transaction-identity guard';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_legacy) INTO v_legacy_def;
    IF pg_catalog.strpos(v_legacy_def, 'INSERT INTO public.resource_delegation_operations') = 0 THEN
        RAISE EXCEPTION 'Legacy initializer body unexpectedly changed';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        JOIN pg_catalog.pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public'
          AND p.oid <> v_legacy
          AND pg_catalog.strpos(p.prosrc, 'public.initialize_resource_delegation(') > 0
    ) THEN
        RAISE EXCEPTION 'An installed public function still calls the legacy delegation initializer';
    END IF;
END;
$preflight$;
