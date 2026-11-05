-- READ-ONLY preflight for 20261101090000_atomic_admin_dispute_settlement.sql.
-- Run only after the candidate migration has been replayed on a disposable,
-- schema-faithful PostgreSQL database. This script creates no test data and
-- performs no wallet, ledger, dispute, or notification mutations.
DO $preflight$
DECLARE
    v_wrapper_oid OID := to_regprocedure(
        'public.admin_resolve_trade_dispute_atomic(uuid,uuid,uuid,uuid,text,text)'
    );
    v_inner_oid OID := to_regprocedure(
        'public.resolve_trade_dispute(uuid,text,uuid,uuid)'
    );
    v_definition TEXT;
    v_config TEXT;
    v_owner TEXT;
BEGIN
    IF v_wrapper_oid IS NULL THEN
        RAISE EXCEPTION 'FAIL: atomic admin dispute wrapper is missing';
    END IF;
    IF v_inner_oid IS NULL THEN
        RAISE EXCEPTION 'FAIL: canonical dispute resolver is missing';
    END IF;

    SELECT pg_get_functiondef(v_wrapper_oid),
           COALESCE(array_to_string(p.proconfig, ','), ''),
           pg_get_userbyid(p.proowner)
      INTO v_definition, v_config, v_owner
      FROM pg_proc AS p
     WHERE p.oid = v_wrapper_oid;

    IF NOT (SELECT p.prosecdef FROM pg_proc AS p WHERE p.oid = v_wrapper_oid) THEN
        RAISE EXCEPTION 'FAIL: atomic wrapper is not SECURITY DEFINER';
    END IF;
    IF v_config NOT LIKE '%search_path=""%' THEN
        RAISE EXCEPTION 'FAIL: atomic wrapper does not use an empty search_path (found %)', v_config;
    END IF;
    IF v_owner <> 'postgres' THEN
        RAISE EXCEPTION 'FAIL: atomic wrapper owner must be postgres (found %)', v_owner;
    END IF;
    IF position('raw_user_meta_data' IN v_definition) > 0 THEN
        RAISE EXCEPTION 'FAIL: atomic wrapper references user-editable auth metadata';
    END IF;
    IF position('admin_audit_logs' IN v_definition) = 0
       OR position('resolve_trade_dispute' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'FAIL: atomic wrapper is missing canonical settlement or mandatory audit logic';
    END IF;

    IF has_function_privilege(
        'anon', 'public.admin_resolve_trade_dispute_atomic(uuid,uuid,uuid,uuid,text,text)', 'EXECUTE'
    ) OR has_function_privilege(
        'authenticated', 'public.admin_resolve_trade_dispute_atomic(uuid,uuid,uuid,uuid,text,text)', 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'FAIL: anon/authenticated can execute the atomic settlement wrapper';
    END IF;
    IF NOT has_function_privilege(
        'service_role', 'public.admin_resolve_trade_dispute_atomic(uuid,uuid,uuid,uuid,text,text)', 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'FAIL: service_role cannot execute the atomic wrapper';
    END IF;

    IF has_function_privilege(
        'anon', 'public.resolve_trade_dispute(uuid,text,uuid,uuid)', 'EXECUTE'
    ) OR has_function_privilege(
        'authenticated', 'public.resolve_trade_dispute(uuid,text,uuid,uuid)', 'EXECUTE'
    ) OR has_function_privilege(
        'service_role', 'public.resolve_trade_dispute(uuid,text,uuid,uuid)', 'EXECUTE'
    ) THEN
        RAISE EXCEPTION 'FAIL: legacy resolver remains directly executable by an API/service role';
    END IF;

    IF position('trade_id' IN v_definition) = 0
       OR position('winner_id' IN v_definition) = 0
       OR position('exactly one open dispute' IN v_definition) = 0 THEN
        RAISE EXCEPTION 'FAIL: wrapper is missing dispute/trade/winner/open-dispute guards';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='profiles' AND column_name='is_admin_account'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='profiles' AND column_name='is_admin'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='trades' AND column_name='is_disputed'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='admin_audit_logs' AND column_name='target_user_id'
    ) OR NOT EXISTS (
        SELECT 1 FROM information_schema.columns
         WHERE table_schema='public' AND table_name='notifications' AND column_name='is_read'
    ) THEN
        RAISE EXCEPTION 'FAIL: one or more columns used by the atomic wrapper are missing';
    END IF;

    RAISE NOTICE 'PASS: atomic dispute settlement preflight. This does not prove escrow ledger behavior, idempotency under concurrency, or rollback semantics.';
END;
$preflight$;
