-- Read-only verification that direct credit is private to postgres
-- and service_role can only use the pending-registration / lease wrapper contract.
DO $check$
DECLARE
  v_credit REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text)'
  );
  v_register REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.register_pending_deposit(text,text,text,numeric,text,integer,bigint,text,text,integer,text)'
  );
  v_confirm REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.process_deposit_atomic_with_lease(uuid,text,text,text,text,numeric,text,integer,bigint,text,text,integer,text,text)'
  );
BEGIN
  IF v_credit IS NULL OR v_register IS NULL OR v_confirm IS NULL THEN
    RAISE EXCEPTION 'FAIL: canonical deposit RPC or its server wrappers are missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = v_credit
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=pg_catalog']::TEXT[]
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = v_register
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=""']::TEXT[]
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = v_confirm
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=""']::TEXT[]
  ) THEN
    RAISE EXCEPTION 'FAIL: deposit RPC ownership or SECURITY DEFINER search_path boundary is not hardened';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))
    ) acl
    WHERE p.oid = v_credit
      AND acl.grantee = 0
      AND acl.privilege_type = 'EXECUTE'
  )
     OR has_function_privilege('service_role', v_credit, 'EXECUTE')
     OR has_function_privilege('anon', v_credit, 'EXECUTE')
     OR has_function_privilege('authenticated', v_credit, 'EXECUTE')
     OR NOT has_function_privilege('postgres', v_credit, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: direct canonical credit RPC remains executable outside postgres';
  END IF;

  IF has_function_privilege('anon', v_register, 'EXECUTE')
     OR has_function_privilege('authenticated', v_register, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_register, 'EXECUTE')
     OR has_function_privilege('anon', v_confirm, 'EXECUTE')
     OR has_function_privilege('authenticated', v_confirm, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_confirm, 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: server-facing registration or lease-credit RPC permissions are incorrect';
  END IF;

  RAISE NOTICE 'PASS: service_role cannot bypass the confirmation lease by calling the canonical credit RPC directly';
END;
$check$;
