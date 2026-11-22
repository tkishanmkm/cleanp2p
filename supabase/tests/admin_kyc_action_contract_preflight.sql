-- Read-only contract checks for atomic full-admin KYC and withdrawal-lock actions.
DO $admin_lifecycle_preflight$
DECLARE
  v_kyc_oid oid := to_regprocedure('public.admin_update_user_kyc_authorized(uuid,text,uuid,text)');
  v_withdrawal_oid oid := to_regprocedure('public.admin_set_user_withdrawal_lock_authorized(uuid,text,uuid,boolean)');
  v_oid oid;
  v_definition text;
BEGIN
  IF v_kyc_oid IS NULL OR v_withdrawal_oid IS NULL THEN
    RAISE EXCEPTION 'One or more authorized administrator lifecycle RPCs are missing.';
  END IF;

  FOREACH v_oid IN ARRAY ARRAY[v_kyc_oid, v_withdrawal_oid]
  LOOP
    SELECT pg_get_functiondef(v_oid) INTO v_definition;

    IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid=v_oid)) <> 'postgres'
       OR NOT (SELECT prosecdef FROM pg_proc WHERE oid=v_oid)
       OR NOT COALESCE((SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid=v_oid), false) THEN
      RAISE EXCEPTION 'Administrator lifecycle RPC % must be postgres-owned SECURITY DEFINER with empty search_path.', v_oid::regprocedure;
    END IF;

    IF position('is_active_full_admin_actor' IN v_definition) = 0
       OR position('auth.jwt()' IN v_definition) = 0
       OR position('FOR UPDATE' IN upper(v_definition)) = 0
       OR position('admin_audit_logs' IN v_definition) = 0 THEN
      RAISE EXCEPTION 'Administrator lifecycle RPC % is missing its actor, row-lock or audit contract.', v_oid::regprocedure;
    END IF;

    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_oid, 'EXECUTE')
       OR EXISTS (
         SELECT 1
         FROM pg_proc AS p
         CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
         WHERE p.oid = v_oid
           AND acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Administrator lifecycle RPC % is not restricted to service_role.', v_oid::regprocedure;
    END IF;
  END LOOP;

  SELECT pg_get_functiondef(v_kyc_oid) INTO v_definition;
  IF position('is_id_verified' IN v_definition) > 0
     OR position('verification_tier = 2' IN v_definition) > 0
     OR position('verification_tier = 1' IN v_definition) > 0
     OR position('kyc_status = ''approved''' IN v_definition) = 0
     OR position('v_new_status := ''approved''' IN v_definition) = 0
     OR position('is_kyc_locked = true' IN v_definition) > 0 THEN
    RAISE EXCEPTION 'KYC RPC uses an obsolete database field, noncanonical verified status, numeric tier, or withdrawal-blocking verified lock.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name='verification_tier' AND data_type='text'
  ) THEN
    RAISE EXCEPTION 'profiles.verification_tier must be text.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name='is_id_verified'
  ) THEN
    RAISE NOTICE 'A compatibility column exists, but canonical application state remains is_verified/id_verified.';
  END IF;
END;
$admin_lifecycle_preflight$;
