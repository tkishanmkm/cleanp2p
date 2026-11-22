-- Read-only verification for authenticated caller-bound presence heartbeat.
DO $preflight$
DECLARE
  v_rpc regprocedure := pg_catalog.to_regprocedure('public.set_my_presence(boolean)');
BEGIN
  IF v_rpc IS NULL THEN
    RAISE EXCEPTION 'set_my_presence(boolean) RPC is missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name IN ('is_online','last_seen_at')
    GROUP BY table_name HAVING count(*)=2
  ) THEN
    RAISE EXCEPTION 'Required profile presence columns are missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid=v_rpc
      AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=""']::text[]
      AND has_function_privilege('authenticated', v_rpc, 'EXECUTE')
      AND NOT has_function_privilege('anon', v_rpc, 'EXECUTE')
      AND NOT has_function_privilege('service_role', v_rpc, 'EXECUTE')
  ) THEN
    RAISE EXCEPTION 'Presence RPC ownership, SECURITY DEFINER, search_path or ACL is incorrect.';
  END IF;

  IF pg_catalog.strpos(pg_catalog.pg_get_functiondef(v_rpc), 'auth.uid()') = 0
     OR pg_catalog.strpos(pg_catalog.pg_get_functiondef(v_rpc), 'last_seen_at') = 0 THEN
    RAISE EXCEPTION 'Presence RPC must derive the owner from auth.uid() and update the heartbeat timestamp.';
  END IF;
END;
$preflight$;
