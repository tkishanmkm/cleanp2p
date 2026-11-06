-- Structural/access preflight for canonical withdrawal reconciliation totals.
-- No rows are inserted, updated, deleted, or used as synthetic financial fixtures.
DO $preflight$
DECLARE
    v_oid regprocedure := to_regprocedure(
        'public.get_withdrawal_reconciliation_totals(text)'
    );
    v_definition text;
    v_result text;
BEGIN
    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'Canonical withdrawal reconciliation totals RPC is missing';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_oid),
           pg_catalog.pg_get_function_result(v_oid)
      INTO v_definition, v_result;

    IF v_result IS DISTINCT FROM
       'TABLE(total_user_liability text, total_pending_withdrawals text)' THEN
        RAISE EXCEPTION 'Reconciliation RPC must return exact decimal text columns; found %', v_result;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM pg_catalog.pg_proc p
        WHERE p.oid = v_oid
          AND p.prosecdef IS TRUE
          AND 'search_path=""' = ANY(coalesce(p.proconfig, ARRAY[]::text[]))
    ) THEN
        RAISE EXCEPTION 'Reconciliation RPC must be SECURITY DEFINER with an empty search_path';
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
        RAISE EXCEPTION 'Reconciliation RPC is executable by an untrusted role';
    END IF;

    IF NOT pg_catalog.has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('postgres', v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'Reconciliation RPC service execution grants are missing';
    END IF;

    IF pg_catalog.strpos(v_definition, 'public.wallet_assets') = 0
       OR pg_catalog.strpos(v_definition, 'wa.balance') = 0
       OR pg_catalog.strpos(v_definition, 'wa.locked_balance') = 0
       OR pg_catalog.strpos(v_definition, 'wa.in_escrow') = 0
       OR pg_catalog.strpos(v_definition, 'wa.in_withdrawal') = 0
       OR pg_catalog.strpos(v_definition, 'public.onchain_withdrawals') = 0
       OR pg_catalog.strpos(v_definition, 'w.amount + coalesce(w.fee, 0)') = 0 THEN
        RAISE EXCEPTION 'Reconciliation RPC is missing canonical wallet or withdrawal accounting fields';
    END IF;

    IF pg_catalog.strpos(v_definition, '''QUEUED''') = 0
       OR pg_catalog.strpos(v_definition, '''READY_TO_BROADCAST''') = 0
       OR pg_catalog.strpos(v_definition, '''AMBIGUOUS_BROADCAST''') = 0
       OR pg_catalog.strpos(v_definition, '''BROADCASTED''') = 0 THEN
        RAISE EXCEPTION 'Reconciliation RPC omits one or more active withdrawal states';
    END IF;

    IF pg_catalog.strpos(v_definition, 'user_wallets') > 0
       OR pg_catalog.strpos(v_definition, 'main_balance') > 0
       OR pg_catalog.strpos(v_definition, 'locked_escrow') > 0
       OR pg_catalog.strpos(v_definition, 'locked_withdrawal') > 0 THEN
        RAISE EXCEPTION 'Reconciliation RPC still depends on incompatible legacy wallet columns';
    END IF;
END;
$preflight$;
