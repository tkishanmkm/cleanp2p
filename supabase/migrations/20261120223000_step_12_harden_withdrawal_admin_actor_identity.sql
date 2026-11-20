-- Step 12: bind withdrawal approval/refund RPCs to a currently active
-- full-admin identity, not stale profile/admin flags alone.
-- Preserve the existing atomic row locks, refund and audit transactions.
BEGIN;

DO $step_12_withdrawal_admin_preflight$
DECLARE
  v_approve REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.approve_withdrawal(uuid,uuid)'
  );
  v_reject REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.reject_withdrawal_pending_approval(uuid,uuid,text)'
  );
  v_verify REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.verify_admin_login(uuid,uuid)'
  );
  v_owner TEXT;
  v_definer BOOLEAN;
  v_config TEXT[];
  v_source TEXT;
BEGIN
  IF v_approve IS NULL OR v_reject IS NULL OR v_verify IS NULL THEN
    RAISE EXCEPTION
      'Step 12 refused: canonical withdrawal approval/rejection RPCs or admin verification helper are missing.';
  END IF;

  IF pg_catalog.to_regprocedure('public.is_active_withdrawal_admin_actor(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION
      'Step 12 refused: is_active_withdrawal_admin_actor(uuid) already exists; review it before replacement.';
  END IF;

  FOR v_owner,v_definer,v_config,v_source IN
    SELECT pg_catalog.pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,p.prosrc
    FROM pg_catalog.pg_proc p
    WHERE p.oid IN (v_approve,v_reject)
  LOOP
    IF v_owner IS DISTINCT FROM 'postgres'
       OR v_definer IS DISTINCT FROM TRUE
       OR v_config IS DISTINCT FROM ARRAY['search_path=""']::TEXT[]
       OR pg_catalog.strpos(v_source,'Service role required')=0
       OR pg_catalog.strpos(v_source,'admin_audit_logs')=0
       OR pg_catalog.strpos(v_source,'p.is_admin = true')=0
       OR pg_catalog.strpos(v_source,'auth.users u')=0
       OR pg_catalog.strpos(v_source,'FOR UPDATE')=0 THEN
      RAISE EXCEPTION
        'Step 12 refused: withdrawal approval/rejection RPC owner, path, grant-protected service boundary, audit, locks or old identity predicate differs from the reviewed state.';
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid=v_verify
      AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=""']::TEXT[]
      AND p.prorettype='record'::REGTYPE
  ) THEN
    RAISE EXCEPTION
      'Step 12 refused: verify_admin_login(uuid,uuid) is not the reviewed Postgres-owned, empty-path verification helper.';
  END IF;

  IF pg_catalog.has_function_privilege('anon',v_approve,'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',v_approve,'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role',v_approve,'EXECUTE')
     OR pg_catalog.has_function_privilege('anon',v_reject,'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',v_reject,'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role',v_reject,'EXECUTE') THEN
    RAISE EXCEPTION
      'Step 12 refused: withdrawal admin RPC execution grants differ from the reviewed service-role-only contract.';
  END IF;
END;
$step_12_withdrawal_admin_preflight$;

CREATE FUNCTION public.is_active_withdrawal_admin_actor(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT CASE
    WHEN p_user_id IS NULL THEN FALSE
    ELSE EXISTS (
      SELECT 1
      FROM auth.users u
      JOIN public.profiles p ON p.id=u.id
      WHERE u.id=p_user_id
        AND EXISTS (
          SELECT 1
          FROM public.verify_admin_login(p_user_id, NULL) AS verification
          WHERE verification.is_valid IS TRUE
        )
        -- Match verifyServerAdmin's full-admin account-state gate.
        AND lower(coalesce(p.status::text, '')) = 'active'
        AND lower(coalesce(p.account_status, '')) NOT IN (
          'banned','suspended','restricted','frozen','blocked',
          'deleted','inactive','closed','on_hold','hold','deletion_pending'
        )
        AND coalesce(p.is_banned, FALSE) = FALSE
        AND coalesce(p.is_suspended, FALSE) = FALSE
        AND coalesce(p.is_restricted, FALSE) = FALSE
        AND coalesce(p.is_on_hold, FALSE) = FALSE
        AND coalesce(p.is_emergency_frozen, FALSE) = FALSE
        AND coalesce(p.is_minor_restricted, FALSE) = FALSE
    )
  END;
$function$;

ALTER FUNCTION public.is_active_withdrawal_admin_actor(UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_active_withdrawal_admin_actor(UUID)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.is_active_withdrawal_admin_actor(UUID)
  TO postgres;

DO $step_12_patch_approval$
DECLARE
  v_oid REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.approve_withdrawal(uuid,uuid)'
  );
  v_definition TEXT;
  v_updated TEXT;
  v_marker TEXT := '  ) INTO v_is_admin;';
  v_start INTEGER;
  v_marker_start INTEGER;
  v_owner_before TEXT;
  v_definer_before BOOLEAN;
  v_config_before TEXT[];
  v_acl_before ACLITEM[];
  v_owner_after TEXT;
  v_definer_after BOOLEAN;
  v_config_after TEXT[];
  v_acl_after ACLITEM[];
BEGIN
  SELECT pg_catalog.pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,p.proacl,
         pg_catalog.pg_get_functiondef(p.oid)
    INTO v_owner_before,v_definer_before,v_config_before,v_acl_before,v_definition
  FROM pg_catalog.pg_proc p WHERE p.oid=v_oid;

  v_start := pg_catalog.strpos(v_definition,'  SELECT EXISTS (');
  IF v_start=0 OR pg_catalog.substr(v_definition,v_start) NOT LIKE '%FROM public.app_admins a%'
     OR pg_catalog.substr(v_definition,v_start) NOT LIKE '%p.is_admin_account = true%'
     OR pg_catalog.substr(v_definition,v_start) NOT LIKE '%raw_app_meta_data%'
     OR pg_catalog.strpos(v_definition,'  ) INTO v_is_admin;')=0 THEN
    RAISE EXCEPTION
      'Step 12 refused: approve_withdrawal admin identity block does not match the reviewed post-20261103073533 definition.';
  END IF;

  v_marker_start := v_start + pg_catalog.strpos(
    pg_catalog.substr(v_definition,v_start),v_marker
  ) - 1;

  v_updated :=
    pg_catalog.substr(v_definition,1,v_start-1)
    || '  v_is_admin := public.is_active_withdrawal_admin_actor(p_admin_id);'
    || pg_catalog.substr(v_definition,v_marker_start+pg_catalog.length(v_marker));

  IF pg_catalog.strpos(v_updated,'public.is_active_withdrawal_admin_actor(p_admin_id)')=0
     OR pg_catalog.strpos(v_updated,'FROM public.app_admins a')>0
     OR pg_catalog.strpos(v_updated,'raw_app_meta_data')>0 THEN
    RAISE EXCEPTION
      'Step 12 failed to replace the complete approve_withdrawal identity block.';
  END IF;

  EXECUTE v_updated;

  SELECT pg_catalog.pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,p.proacl
    INTO v_owner_after,v_definer_after,v_config_after,v_acl_after
  FROM pg_catalog.pg_proc p WHERE p.oid=v_oid;

  IF v_owner_after IS DISTINCT FROM v_owner_before
     OR v_definer_after IS DISTINCT FROM v_definer_before
     OR v_config_after IS DISTINCT FROM v_config_before
     OR v_acl_after IS DISTINCT FROM v_acl_before THEN
    RAISE EXCEPTION
      'Step 12 failed: approve_withdrawal owner, SECURITY DEFINER, search_path or grants changed.';
  END IF;
END;
$step_12_patch_approval$;

DO $step_12_patch_rejection$
DECLARE
  v_oid REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.reject_withdrawal_pending_approval(uuid,uuid,text)'
  );
  v_definition TEXT;
  v_updated TEXT;
  v_marker TEXT := '  ) INTO v_admin;';
  v_start INTEGER;
  v_marker_start INTEGER;
  v_owner_before TEXT;
  v_definer_before BOOLEAN;
  v_config_before TEXT[];
  v_acl_before ACLITEM[];
  v_owner_after TEXT;
  v_definer_after BOOLEAN;
  v_config_after TEXT[];
  v_acl_after ACLITEM[];
BEGIN
  SELECT pg_catalog.pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,p.proacl,
         pg_catalog.pg_get_functiondef(p.oid)
    INTO v_owner_before,v_definer_before,v_config_before,v_acl_before,v_definition
  FROM pg_catalog.pg_proc p WHERE p.oid=v_oid;

  v_start := pg_catalog.strpos(v_definition,'  SELECT EXISTS (');
  IF v_start=0 OR pg_catalog.substr(v_definition,v_start) NOT LIKE '%FROM public.app_admins a%'
     OR pg_catalog.substr(v_definition,v_start) NOT LIKE '%p.is_admin_account = true%'
     OR pg_catalog.substr(v_definition,v_start) NOT LIKE '%raw_app_meta_data%'
     OR pg_catalog.strpos(v_definition,'  ) INTO v_admin;')=0 THEN
    RAISE EXCEPTION
      'Step 12 refused: reject_withdrawal_pending_approval admin identity block does not match the reviewed post-20261103073533 definition.';
  END IF;

  v_marker_start := v_start + pg_catalog.strpos(
    pg_catalog.substr(v_definition,v_start),v_marker
  ) - 1;

  v_updated :=
    pg_catalog.substr(v_definition,1,v_start-1)
    || '  v_admin := public.is_active_withdrawal_admin_actor(p_admin_id);'
    || pg_catalog.substr(v_definition,v_marker_start+pg_catalog.length(v_marker));

  IF pg_catalog.strpos(v_updated,'public.is_active_withdrawal_admin_actor(p_admin_id)')=0
     OR pg_catalog.strpos(v_updated,'FROM public.app_admins a')>0
     OR pg_catalog.strpos(v_updated,'raw_app_meta_data')>0 THEN
    RAISE EXCEPTION
      'Step 12 failed to replace the complete reject_withdrawal_pending_approval identity block.';
  END IF;

  EXECUTE v_updated;

  SELECT pg_catalog.pg_get_userbyid(p.proowner),p.prosecdef,p.proconfig,p.proacl
    INTO v_owner_after,v_definer_after,v_config_after,v_acl_after
  FROM pg_catalog.pg_proc p WHERE p.oid=v_oid;

  IF v_owner_after IS DISTINCT FROM v_owner_before
     OR v_definer_after IS DISTINCT FROM v_definer_before
     OR v_config_after IS DISTINCT FROM v_config_before
     OR v_acl_after IS DISTINCT FROM v_acl_before THEN
    RAISE EXCEPTION
      'Step 12 failed: reject_withdrawal_pending_approval owner, SECURITY DEFINER, search_path or grants changed.';
  END IF;
END;
$step_12_patch_rejection$;

DO $step_12_postconditions$
DECLARE
  v_helper REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.is_active_withdrawal_admin_actor(uuid)'
  );
  v_approve REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.approve_withdrawal(uuid,uuid)'
  );
  v_reject REGPROCEDURE := pg_catalog.to_regprocedure(
    'public.reject_withdrawal_pending_approval(uuid,uuid,text)'
  );
  v_approve_source TEXT;
  v_reject_source TEXT;
BEGIN
  SELECT p.prosrc INTO v_approve_source FROM pg_catalog.pg_proc p WHERE p.oid=v_approve;
  SELECT p.prosrc INTO v_reject_source FROM pg_catalog.pg_proc p WHERE p.oid=v_reject;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid=v_helper
      AND pg_catalog.pg_get_userbyid(p.proowner)='postgres'
      AND p.prosecdef IS TRUE
      AND p.proconfig @> ARRAY['search_path=""']::TEXT[]
      AND NOT pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')
      AND NOT pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')
      AND pg_catalog.has_function_privilege('postgres',p.oid,'EXECUTE')
  ) OR pg_catalog.strpos(v_approve_source,'public.is_active_withdrawal_admin_actor(p_admin_id)')=0
    OR pg_catalog.strpos(v_reject_source,'public.is_active_withdrawal_admin_actor(p_admin_id)')=0
    OR pg_catalog.strpos(v_approve_source,'admin_audit_logs')=0
    OR pg_catalog.strpos(v_reject_source,'admin_audit_logs')=0 THEN
    RAISE EXCEPTION
      'Step 12 failed postcondition: active full-admin identity gate or atomic audit writes are missing.';
  END IF;
END;
$step_12_postconditions$;

COMMIT;
