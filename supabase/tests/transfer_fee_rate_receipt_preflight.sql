-- Read-only contract preflight for fee-rate snapshots in transfer receipts.
DO $preflight$
DECLARE
    v_oid regprocedure := to_regprocedure(
        'public.execute_internal_transfer(uuid,text,text,numeric,text)'
    );
    v_definition text;
BEGIN
    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'Canonical internal transfer RPC is missing';
    END IF;

    SELECT pg_catalog.pg_get_functiondef(v_oid) INTO v_definition;

    IF NOT EXISTS (
        SELECT 1 FROM pg_catalog.pg_proc p
        WHERE p.oid=v_oid AND p.prosecdef IS TRUE
          AND 'search_path=pg_catalog' = ANY(coalesce(p.proconfig,ARRAY[]::text[]))
    ) OR NOT pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE')
       OR pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE') THEN
        RAISE EXCEPTION 'Canonical transfer RPC security/grant contract changed';
    END IF;

    IF pg_catalog.strpos(v_definition, 'v_existing_fee_rate NUMERIC') = 0
       OR pg_catalog.strpos(v_definition, '''fee_rate'', v_existing_fee_rate') = 0
       OR pg_catalog.strpos(v_definition, '''fee_rate'', v_fee_rate') = 0
       OR pg_catalog.strpos(v_definition, 'metadata->>''direction'' = ''SENT''') = 0
       OR pg_catalog.strpos(v_definition, 'public.ledger_entries') = 0
       OR pg_catalog.strpos(v_definition, 'public.app_settings') = 0 THEN
        RAISE EXCEPTION 'Transfer receipts do not include the exact committed fee-rate snapshot';
    END IF;

    IF pg_catalog.strpos(v_definition, 'v_fee_rate NUMERIC(10, 6) := 0.015') > 0 THEN
        RAISE EXCEPTION 'Hard-coded transfer fee rate remains in the canonical RPC';
    END IF;
END;
$preflight$;
