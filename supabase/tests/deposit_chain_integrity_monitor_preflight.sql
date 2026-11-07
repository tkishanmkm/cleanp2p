-- Read-only contract checks for the post-credit deposit integrity monitor.
DO $preflight$
DECLARE
  v_claim regprocedure := pg_catalog.to_regprocedure(
    'public.claim_deposit_integrity_checks(text,integer,integer)'
  );
  v_complete regprocedure := pg_catalog.to_regprocedure(
    'public.complete_deposit_integrity_check(uuid,text,text,text,text,jsonb,integer)'
  );
BEGIN
  IF v_claim IS NULL OR v_complete IS NULL THEN
    RAISE EXCEPTION 'Deposit integrity monitor RPC functions are missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'onchain_deposits'
      AND column_name IN (
        'block_number', 'block_hash', 'integrity_check_owner',
        'integrity_check_lease_expires_at', 'integrity_check_last_at', 'integrity_check_next_at'
      )
    GROUP BY table_name
    HAVING count(*) = 6
  ) THEN
    RAISE EXCEPTION 'Persisted block identity or integrity lease columns are missing.';
  END IF;

  IF pg_catalog.to_regclass('public.deposit_chain_integrity_events') IS NULL THEN
    RAISE EXCEPTION 'Durable deposit chain integrity event table is missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    WHERE c.oid = 'public.deposit_chain_integrity_events'::regclass
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'Deposit integrity event table must have row-level security enabled.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = v_claim
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=""']::text[]
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = v_complete
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=""']::text[]
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
  ) THEN
    RAISE EXCEPTION 'Deposit integrity RPCs must be postgres-owned SECURITY DEFINER functions with empty search_path.';
  END IF;

  IF NOT has_function_privilege('service_role', v_claim, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_complete, 'EXECUTE')
     OR has_function_privilege('anon', v_claim, 'EXECUTE')
     OR has_function_privilege('authenticated', v_claim, 'EXECUTE')
     OR has_function_privilege('anon', v_complete, 'EXECUTE')
     OR has_function_privilege('authenticated', v_complete, 'EXECUTE') THEN
    RAISE EXCEPTION 'Deposit integrity RPC execution grants are not service-role only.';
  END IF;

  IF has_table_privilege('anon', 'public.deposit_chain_integrity_events', 'SELECT')
     OR has_table_privilege('authenticated', 'public.deposit_chain_integrity_events', 'SELECT')
     OR has_table_privilege('service_role', 'public.deposit_chain_integrity_events', 'SELECT') THEN
    RAISE EXCEPTION 'Deposit integrity events must not allow direct table reads.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_indexes
    WHERE schemaname = 'public' AND indexname = 'uq_system_alerts_active_dedupe_key'
  ) THEN
    RAISE EXCEPTION 'Active system alert deduplication index is missing.';
  END IF;
END;
$preflight$;
