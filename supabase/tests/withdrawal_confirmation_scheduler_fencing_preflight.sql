-- Structural/access preflight for the due-confirmation compare-and-set RPC.
-- No synthetic withdrawal rows or financial state transitions are performed.
DO $preflight$
DECLARE
    v_oid regprocedure := to_regprocedure(
        'public.schedule_withdrawal_confirmation_check(uuid,text,timestamptz)'
    );
    v_definition text;
BEGIN
    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'Withdrawal confirmation scheduler RPC is missing';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_oid)
      INTO v_definition;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        WHERE p.oid = v_oid
          AND p.prosecdef IS TRUE
          AND 'search_path=""' = ANY(coalesce(p.proconfig, ARRAY[]::text[]))
    ) THEN
        RAISE EXCEPTION 'Scheduler RPC must be SECURITY DEFINER with an empty search_path';
    END IF;

    IF pg_catalog.has_function_privilege('anon', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('supabase_auth_admin', v_oid, 'EXECUTE')
       OR EXISTS (
           SELECT 1
           FROM pg_catalog.pg_proc p
           CROSS JOIN LATERAL pg_catalog.aclexplode(
               coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))
           ) acl
           WHERE p.oid = v_oid
             AND acl.grantee = 0
             AND acl.privilege_type = 'EXECUTE'
       ) THEN
        RAISE EXCEPTION 'Scheduler RPC is executable by an untrusted role';
    END IF;

    IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('postgres', v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'Scheduler service execution grants are missing';
    END IF;

    IF pg_catalog.strpos(v_definition, 'next_confirmation_check_at <= v_now') = 0
       OR pg_catalog.strpos(v_definition, 'UPDATE public.onchain_withdrawals') = 0
       OR pg_catalog.strpos(v_definition, 'lower(tx_hash) = v_hash') = 0
       OR pg_catalog.strpos(v_definition, 'RETURN v_claimed_id IS NOT NULL') = 0 THEN
        RAISE EXCEPTION 'Scheduler RPC is missing the due-time/hash compare-and-set fence';
    END IF;

    IF pg_catalog.strpos(v_definition, 'updated_at') > 0 THEN
        RAISE EXCEPTION 'Confirmation scheduling must not mutate withdrawal updated_at';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'onchain_withdrawals'
          AND column_name = 'next_confirmation_check_at'
          AND is_nullable = 'NO'
    ) THEN
        RAISE EXCEPTION 'Non-null confirmation schedule column is missing';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_indexes
        WHERE schemaname = 'public'
          AND tablename = 'onchain_withdrawals'
          AND indexname = 'idx_onchain_withdrawals_confirmation_due'
    ) THEN
        RAISE EXCEPTION 'Confirmation due-time index is missing';
    END IF;
END;
$preflight$;
