-- Step 13: remove writable application schemas from the SECURITY DEFINER
-- auth.users signup trigger. The reviewed function uses schema-qualified
-- relations, sequence and helper calls, so it does not need public/auth in
-- search_path. Preserve its body, owner, security mode, ACL and trigger binding.
BEGIN;

DO $step_13_signup_wallet_search_path_preflight$
DECLARE
  v_oid REGPROCEDURE := pg_catalog.to_regprocedure('public.handle_new_user()');
  v_owner TEXT;
  v_definer BOOLEAN;
  v_config TEXT[];
  v_acl ACLITEM[];
  v_source TEXT;
  v_trigger_count INTEGER;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION
      'Step 13 refused: public.handle_new_user() signup trigger function is missing.';
  END IF;

  SELECT
    pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.proconfig,
    p.proacl,
    p.prosrc
  INTO v_owner,v_definer,v_config,v_acl,v_source
  FROM pg_catalog.pg_proc p
  WHERE p.oid=v_oid;

  IF v_owner IS DISTINCT FROM 'postgres'
     OR v_definer IS DISTINCT FROM TRUE
     OR v_config IS DISTINCT FROM ARRAY['search_path=public, auth, pg_temp']::TEXT[]
     OR pg_catalog.strpos(v_source,'public.user_wallet_index_seq')=0
     OR pg_catalog.strpos(v_source,'INSERT INTO public.profiles')=0
     OR pg_catalog.strpos(v_source,'public.generate_system_username()')=0
     OR pg_catalog.strpos(v_source,'ON CONFLICT (id) DO UPDATE')=0
     OR pg_catalog.strpos(pg_catalog.upper(v_source),'EXECUTE ')>0 THEN
    RAISE EXCEPTION
      'Step 13 refused: handle_new_user owner, SECURITY DEFINER mode, search_path or wallet-index/profile implementation differs from the reviewed source.';
  END IF;

  SELECT count(*)::INTEGER
    INTO v_trigger_count
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='auth'
    AND c.relname='users'
    AND t.tgfoid=v_oid
    AND NOT t.tgisinternal
    AND t.tgenabled='O'
    AND (t.tgtype & 4)=4;

  IF v_trigger_count <> 1 THEN
    RAISE EXCEPTION
      'Step 13 refused: expected exactly one enabled AFTER INSERT auth.users trigger bound to handle_new_user(), found %.',
      v_trigger_count;
  END IF;

  IF v_acl IS NULL
     OR NOT pg_catalog.has_function_privilege('service_role',v_oid,'EXECUTE')
     OR pg_catalog.has_function_privilege('anon',v_oid,'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',v_oid,'EXECUTE') THEN
    RAISE EXCEPTION
      'Step 13 refused: signup trigger function grants differ from the reviewed service-role-only contract.';
  END IF;
END;
$step_13_signup_wallet_search_path_preflight$;

DO $step_13_signup_wallet_search_path_change$
DECLARE
  v_oid REGPROCEDURE := pg_catalog.to_regprocedure('public.handle_new_user()');
  v_owner_before TEXT;
  v_definer_before BOOLEAN;
  v_acl_before ACLITEM[];
  v_source_before TEXT;
  v_owner_after TEXT;
  v_definer_after BOOLEAN;
  v_config_after TEXT[];
  v_acl_after ACLITEM[];
  v_source_after TEXT;
BEGIN
  SELECT
    pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.proacl,
    p.prosrc
  INTO v_owner_before,v_definer_before,v_acl_before,v_source_before
  FROM pg_catalog.pg_proc p
  WHERE p.oid=v_oid;

  ALTER FUNCTION public.handle_new_user() SET search_path = '';

  SELECT
    pg_catalog.pg_get_userbyid(p.proowner),
    p.prosecdef,
    p.proconfig,
    p.proacl,
    p.prosrc
  INTO v_owner_after,v_definer_after,v_config_after,v_acl_after,v_source_after
  FROM pg_catalog.pg_proc p
  WHERE p.oid=v_oid;

  IF v_owner_after IS DISTINCT FROM v_owner_before
     OR v_definer_after IS DISTINCT FROM v_definer_before
     OR v_acl_after IS DISTINCT FROM v_acl_before
     OR v_source_after IS DISTINCT FROM v_source_before
     OR v_config_after IS DISTINCT FROM ARRAY['search_path=""']::TEXT[] THEN
    RAISE EXCEPTION
      'Step 13 failed: handle_new_user body, owner, SECURITY DEFINER mode, ACL or empty search_path postcondition changed unexpectedly.';
  END IF;
END;
$step_13_signup_wallet_search_path_change$;

DO $step_13_signup_wallet_search_path_postcondition$
DECLARE
  v_oid REGPROCEDURE := pg_catalog.to_regprocedure('public.handle_new_user()');
  v_trigger_count INTEGER;
BEGIN
  SELECT count(*)::INTEGER
    INTO v_trigger_count
  FROM pg_catalog.pg_trigger t
  JOIN pg_catalog.pg_class c ON c.oid=t.tgrelid
  JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='auth'
    AND c.relname='users'
    AND t.tgfoid=v_oid
    AND NOT t.tgisinternal
    AND t.tgenabled='O'
    AND (t.tgtype & 4)=4;

  IF v_trigger_count <> 1
     OR NOT EXISTS (
       SELECT 1
       FROM pg_catalog.pg_proc p
       WHERE p.oid=v_oid
         AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
         AND p.prosecdef IS TRUE
         AND p.proconfig IS NOT DISTINCT FROM ARRAY['search_path=""']::TEXT[]
         AND pg_catalog.strpos(p.prosrc,'public.user_wallet_index_seq')>0
     ) THEN
    RAISE EXCEPTION
      'Step 13 failed postcondition: signup wallet index allocator or auth.users trigger binding is no longer valid.';
  END IF;
END;
$step_13_signup_wallet_search_path_postcondition$;

COMMIT;
