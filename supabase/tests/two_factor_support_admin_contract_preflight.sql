-- Read-only structural, ownership and ACL preflight for the forward 2FA/support-admin release.
-- This is not a substitute for application-level OTP, cookie or authorization review.
DO $preflight$
DECLARE
  v_signature text;
  v_oid oid;
  v_owner text;
  v_config text[];
  v_is_definer boolean;
  v_table regclass;
  v_definition text;
  v_tables text[] := ARRAY[
    'admin_2fa_rate_limits',
    'user_2fa_rate_limits',
    'support_admin_grants',
    'support_admin_emergency_sessions',
    'support_admin_activity'
  ];
  v_functions text[] := ARRAY[
    'public.check_admin_2fa_rate_limit(uuid)',
    'public.reset_admin_2fa_rate_limit(uuid)',
    'public.check_user_2fa_rate_limit(uuid)',
    'public.reset_user_2fa_rate_limit(uuid)',
    'public.enable_user_2fa_atomic(uuid,text,jsonb,boolean)',
    'public.disable_user_2fa_atomic(uuid,text,text,text)',
    'public.consume_user_2fa_recovery_code_with_audit(uuid,text,text,text)',
    'public.enable_admin_2fa_atomic(uuid,text,text,text,timestamptz)',
    'public.disable_admin_2fa_atomic(uuid,text,text,timestamptz)',
    'public.recover_admin_2fa_atomic(uuid,text,text,timestamptz)',
    'public.rotate_admin_2fa_recovery_atomic(uuid,text,text,text,timestamptz)',
    'public.is_active_full_admin_actor(uuid)',
    'public.configure_support_admin(uuid,uuid,boolean,integer)',
    'public.activate_support_admin_emergency(uuid,timestamptz)',
    'public.revoke_support_admin_emergency(uuid,uuid,uuid,text)'
  ];
BEGIN
  FOREACH v_signature IN ARRAY v_tables LOOP
    v_table := to_regclass(format('public.%I', v_signature));
    IF v_table IS NULL THEN
      RAISE EXCEPTION 'FAIL: required table public.% is missing', v_signature;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_class c
      WHERE c.oid = v_table AND c.relrowsecurity IS TRUE
    ) THEN
      RAISE EXCEPTION 'FAIL: RLS is not enabled on %', v_table;
    END IF;
    IF NOT has_table_privilege('service_role', v_table, 'SELECT')
       OR NOT has_table_privilege('service_role', v_table, 'INSERT')
       OR NOT has_table_privilege('service_role', v_table, 'UPDATE')
       OR NOT has_table_privilege('service_role', v_table, 'DELETE') THEN
      RAISE EXCEPTION 'FAIL: service_role is missing required access on %', v_table;
    END IF;
    IF has_table_privilege('anon', v_table, 'SELECT')
       OR has_table_privilege('anon', v_table, 'INSERT')
       OR has_table_privilege('anon', v_table, 'UPDATE')
       OR has_table_privilege('anon', v_table, 'DELETE')
       OR has_table_privilege('authenticated', v_table, 'SELECT')
       OR has_table_privilege('authenticated', v_table, 'INSERT')
       OR has_table_privilege('authenticated', v_table, 'UPDATE')
       OR has_table_privilege('authenticated', v_table, 'DELETE')
       OR has_table_privilege('supabase_auth_admin', v_table, 'SELECT')
       OR has_table_privilege('supabase_auth_admin', v_table, 'INSERT')
       OR has_table_privilege('supabase_auth_admin', v_table, 'UPDATE')
       OR has_table_privilege('supabase_auth_admin', v_table, 'DELETE') THEN
      RAISE EXCEPTION 'FAIL: a browser/Auth role has direct table privileges on %', v_table;
    END IF;
  END LOOP;

  -- User enrollment and recovery-code storage must remain server-only too.
  FOREACH v_signature IN ARRAY ARRAY[
    'public.user_2fa_pending_enrollments',
    'public.user_2fa_recovery_codes'
  ] LOOP
    v_table := v_signature::regclass;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = v_table) THEN
      RAISE EXCEPTION 'FAIL: RLS is not enabled on %', v_table;
    END IF;
    IF has_table_privilege('anon', v_table, 'SELECT')
       OR has_table_privilege('anon', v_table, 'INSERT')
       OR has_table_privilege('anon', v_table, 'UPDATE')
       OR has_table_privilege('anon', v_table, 'DELETE')
       OR has_table_privilege('authenticated', v_table, 'SELECT')
       OR has_table_privilege('authenticated', v_table, 'INSERT')
       OR has_table_privilege('authenticated', v_table, 'UPDATE')
       OR has_table_privilege('authenticated', v_table, 'DELETE') THEN
      RAISE EXCEPTION 'FAIL: browser role has direct access to %', v_table;
    END IF;
  END LOOP;

  FOREACH v_signature IN ARRAY v_functions LOOP
    v_oid := to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'FAIL: required RPC/helper % is missing', v_signature;
    END IF;
    SELECT p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner)
      INTO v_is_definer, v_config, v_owner
      FROM pg_proc p
     WHERE p.oid = v_oid;
    IF v_is_definer IS DISTINCT FROM TRUE THEN
      RAISE EXCEPTION 'FAIL: % is not SECURITY DEFINER', v_signature;
    END IF;
    IF NOT ('search_path=""' = ANY(COALESCE(v_config, ARRAY[]::text[]))) THEN
      RAISE EXCEPTION 'FAIL: % does not use an empty search_path', v_signature;
    END IF;
    IF v_owner <> 'postgres' THEN
      RAISE EXCEPTION 'FAIL: % owner is %, expected postgres', v_signature, v_owner;
    END IF;
    IF has_function_privilege('anon', v_oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_oid, 'EXECUTE')
       OR EXISTS (
         SELECT 1
         FROM pg_proc p
         CROSS JOIN LATERAL aclexplode(
           COALESCE(p.proacl, acldefault('f', p.proowner))
         ) AS acl
         WHERE p.oid = v_oid
           AND acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'FAIL: % is executable by anon/authenticated/PUBLIC', v_signature;
    END IF;

    IF v_signature = 'public.is_active_full_admin_actor(uuid)' THEN
      IF has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'FAIL: internal full-admin helper is directly executable by service_role';
      END IF;
    ELSIF NOT has_function_privilege('service_role', v_oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'FAIL: service_role cannot execute %', v_signature;
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indexrelid = to_regclass('public.user_2fa_recovery_codes_active_hash_uidx')
      AND i.indisunique AND i.indisvalid
      AND pg_get_indexdef(i.indexrelid) LIKE '%(user_id, code_hash)%'
      AND pg_get_expr(i.indpred, i.indrelid) LIKE '%invalidated_at IS NULL%'
      AND pg_get_expr(i.indpred, i.indrelid) LIKE '%used_at IS NULL%'
  ) THEN
    RAISE EXCEPTION 'FAIL: active user recovery-code uniqueness index is missing/invalid';
  END IF;

  SELECT lower(pg_get_functiondef(
    'public.disable_user_2fa_atomic(uuid,text,text,text)'::regprocedure
  )) INTO v_definition;
  IF strpos(v_definition, 'if v_rows = 0') = 0
     OR strpos(v_definition, 'if v_rows > 2') = 0
     OR strpos(v_definition, 'code_hash in (p_recovery_code_hash, p_legacy_code_hash)') = 0 THEN
    RAISE EXCEPTION 'FAIL: user 2FA disable does not safely consume all legacy/current hash aliases';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
    WHERE i.indrelid = 'public.support_admin_emergency_sessions'::regclass
      AND i.indisunique AND i.indisvalid
      AND pg_get_indexdef(i.indexrelid) LIKE '%support_admin_id%'
      AND strpos(pg_get_expr(i.indpred, i.indrelid), 'revoked_at IS NULL') > 0
  ) THEN
    RAISE EXCEPTION 'FAIL: one-unrevoked-emergency-session unique index is missing/invalid';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = 'public.support_admin_grants'::regclass
      AND c.conname = 'support_admin_use_accounting_check'
      AND replace(replace(replace(pg_get_constraintdef(c.oid), ' ', ''), '(', ''), ')', '') LIKE
          '%emergency_uses_granted=emergency_uses_consumed+emergency_uses_remaining%'
  ) THEN
    RAISE EXCEPTION 'FAIL: support-admin emergency-use accounting invariant is missing';
  END IF;

  SELECT lower(pg_get_functiondef('public.configure_support_admin(uuid,uuid,boolean,integer)'::regprocedure))
    INTO v_definition;
  IF strpos(v_definition, 'public.is_active_full_admin_actor') = 0
     OR strpos(v_definition, 'if not p_enable') = 0
     OR strpos(v_definition, 'revoked_at') = 0
     OR strpos(v_definition, 'admin_audit_logs') = 0
     OR strpos(v_definition, 'verify_admin_login') = 0 THEN
    RAISE EXCEPTION 'FAIL: support-admin configuration lacks canonical actor check, session invalidation or atomic audit';
  END IF;

  SELECT lower(pg_get_functiondef('public.activate_support_admin_emergency(uuid,timestamptz)'::regprocedure))
    INTO v_definition;
  IF strpos(v_definition, 'verify_admin_login') = 0
     OR strpos(v_definition, 'emergency_uses_remaining') = 0
     OR strpos(v_definition, 'two_factor_verified_at') = 0
     OR strpos(v_definition, 'interval ''3 hours''') = 0 THEN
    RAISE EXCEPTION 'FAIL: support emergency activation security checks are incomplete';
  END IF;

  FOREACH v_signature IN ARRAY ARRAY[
    'public.enable_admin_2fa_atomic(uuid,text,text,text,timestamptz)',
    'public.disable_admin_2fa_atomic(uuid,text,text,timestamptz)',
    'public.recover_admin_2fa_atomic(uuid,text,text,timestamptz)',
    'public.rotate_admin_2fa_recovery_atomic(uuid,text,text,text,timestamptz)'
  ] LOOP
    SELECT lower(pg_get_functiondef(to_regprocedure(v_signature))) INTO v_definition;
    IF strpos(v_definition, 'verify_admin_login') = 0
       OR strpos(v_definition, 'status::text') = 0
       OR strpos(v_definition, 'is_emergency_frozen') = 0 THEN
      RAISE EXCEPTION 'FAIL: % lacks canonical admin authorization or active-account checks', v_signature;
    END IF;
  END LOOP;

  SELECT lower(pg_get_functiondef('public.is_active_full_admin_actor(uuid)'::regprocedure))
    INTO v_definition;
  IF strpos(v_definition, 'verify_admin_login') = 0
     OR strpos(v_definition, 'is_emergency_frozen') = 0
     OR strpos(v_definition, 'is_minor_restricted') = 0 THEN
    RAISE EXCEPTION 'FAIL: full-admin support actor helper omits canonical or account-state checks';
  END IF;

  RAISE NOTICE 'PASS: 2FA/support-admin tables, exact RPC signatures, ownership, empty search_path, client ACLs, uniqueness and session/accounting safeguards are present.';
END;
$preflight$;
