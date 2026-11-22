-- READ-ONLY preflight for the user 2FA lifecycle/rate-limit migrations:
-- 20261101180000_persist_user_2fa_rate_limits.sql
-- 20261101190000_atomic_user_2fa_lifecycle.sql
-- 20261101220000_atomic_user_2fa_recovery_code_audit.sql
--
-- Run only after those migrations have been replayed on a disposable,
-- schema-faithful PostgreSQL database. This script does not write or mutate data.
DO $preflight$
DECLARE
  v_signature TEXT;
  v_oid OID;
  v_config TEXT;
  v_owner TEXT;
  v_is_definer BOOLEAN;
  v_table TEXT;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'user_2fa_pending_enrollments',
    'user_2fa_recovery_codes',
    'user_security_audit_logs',
    'user_2fa_rate_limits'
  ]
  LOOP
    IF to_regclass(format('public.%I', v_table)) IS NULL THEN
      RAISE EXCEPTION 'FAIL: required public.% table is missing', v_table;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'user_2fa_rate_limits'
      AND c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'FAIL: user_2fa_rate_limits does not have RLS enabled';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.check_user_2fa_rate_limit(uuid)',
    'public.reset_user_2fa_rate_limit(uuid)',
    'public.enable_user_2fa_atomic(uuid,text,jsonb,boolean)',
    'public.disable_user_2fa_atomic(uuid,text,text)',
    'public.consume_user_2fa_recovery_code_with_audit(uuid,text,text)'
  ]
  LOOP
    v_oid := to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'FAIL: required RPC % is missing', v_signature;
    END IF;

    SELECT COALESCE(array_to_string(p.proconfig, ','), ''),
           pg_get_userbyid(p.proowner),
           p.prosecdef
      INTO v_config, v_owner, v_is_definer
      FROM pg_proc p
     WHERE p.oid = v_oid;

    IF v_is_definer IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'FAIL: RPC % must be SECURITY DEFINER', v_oid::regprocedure;
    END IF;
    IF v_config NOT LIKE '%search_path=""%' THEN
      RAISE EXCEPTION 'FAIL: RPC % must use an empty search_path (found %)', v_oid::regprocedure, v_config;
    END IF;
    IF v_owner <> 'postgres' THEN
      RAISE EXCEPTION 'FAIL: RPC % must be owned by postgres (found %)', v_oid::regprocedure, v_owner;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: anon/authenticated can execute %', v_oid::regprocedure;
    END IF;
    IF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: service_role cannot execute %', v_oid::regprocedure;
    END IF;
  END LOOP;

  IF has_table_privilege('anon', 'public.user_2fa_rate_limits', 'SELECT')
     OR has_table_privilege('anon', 'public.user_2fa_rate_limits', 'INSERT')
     OR has_table_privilege('anon', 'public.user_2fa_rate_limits', 'UPDATE')
     OR has_table_privilege('anon', 'public.user_2fa_rate_limits', 'DELETE')
     OR has_table_privilege('authenticated', 'public.user_2fa_rate_limits', 'SELECT')
     OR has_table_privilege('authenticated', 'public.user_2fa_rate_limits', 'INSERT')
     OR has_table_privilege('authenticated', 'public.user_2fa_rate_limits', 'UPDATE')
     OR has_table_privilege('authenticated', 'public.user_2fa_rate_limits', 'DELETE') THEN
    RAISE EXCEPTION 'FAIL: user_2fa_rate_limits is directly accessible by a browser role';
  END IF;

  RAISE NOTICE 'PASS: user 2FA lifecycle/rate-limit schema, search_path and role-grant preflight. This does not prove OTP, recovery-code concurrency, rollback or cookie behavior.';
END;
$preflight$;
