BEGIN;

DO $migration$
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
    RAISE EXCEPTION 'Required canonical deposit RPC or lease wrapper is missing; refusing to revoke the current credit path.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_credit
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=pg_catalog']::TEXT[]
  ) THEN
    RAISE EXCEPTION 'Canonical deposit credit function is not owned by postgres with SECURITY DEFINER and search_path=pg_catalog.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_register
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=""']::TEXT[]
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc p
    WHERE p.oid = v_confirm
      AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=""']::TEXT[]
  ) THEN
    RAISE EXCEPTION 'Pending-registration and lease-credit wrappers must be postgres-owned SECURITY DEFINER functions with empty search_path.';
  END IF;

  IF NOT has_function_privilege('service_role', v_register, 'EXECUTE')
     OR NOT has_function_privilege('service_role', v_confirm, 'EXECUTE') THEN
    RAISE EXCEPTION 'Service role must retain execute access to the pending-registration and lease-credit wrappers.';
  END IF;

  REVOKE ALL ON FUNCTION public.process_deposit_atomic(
    text,text,text,numeric,text,integer,bigint,text,text,integer,text
  ) FROM PUBLIC, anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.process_deposit_atomic(
    text,text,text,numeric,text,integer,bigint,text,text,integer,text
  ) TO postgres;

  IF has_function_privilege('service_role', v_credit, 'EXECUTE')
     OR has_function_privilege('anon', v_credit, 'EXECUTE')
     OR has_function_privilege('authenticated', v_credit, 'EXECUTE')
     OR NOT has_function_privilege('postgres', v_credit, 'EXECUTE') THEN
    RAISE EXCEPTION 'Direct canonical credit RPC revocation did not produce the required ACL.';
  END IF;
END;
$migration$;

COMMIT;
