-- Read-only contract checks for global ad pause/resume/delete.
DO $atomic_bulk_ad_controls_preflight$
DECLARE
  v_oid oid := to_regprocedure('public.admin_bulk_ads_action_atomic(uuid,text,text)');
  v_definition text;
BEGIN
  IF v_oid IS NULL THEN
    RAISE EXCEPTION 'Atomic bulk ad control RPC is missing.';
  END IF;

  SELECT pg_get_functiondef(v_oid) INTO v_definition;

  IF pg_get_userbyid((SELECT proowner FROM pg_proc WHERE oid = v_oid)) <> 'postgres'
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_oid)
     OR NOT COALESCE(
       (SELECT proconfig @> ARRAY['search_path=""'] FROM pg_proc WHERE oid = v_oid),
       FALSE
     ) THEN
    RAISE EXCEPTION 'Bulk ad control RPC must remain postgres-owned SECURITY DEFINER with empty search_path.';
  END IF;

  IF position('AUTH.ROLE()' IN upper(v_definition)) = 0
     OR position('PUBLIC.APP_ADMINS' IN upper(v_definition)) = 0
     OR position('SUPPORT_ADMIN_GRANTS' IN upper(v_definition)) = 0
     OR position('V_ADMIN_IS_RESTRICTED' IN upper(v_definition)) = 0
     OR position('V_ADMIN_IS_EMERGENCY_FROZEN' IN upper(v_definition)) = 0
     OR position('V_ADMIN_IS_MINOR_RESTRICTED' IN upper(v_definition)) = 0
     OR position('V_ADMIN_PROFILE_ROLE' IN upper(v_definition)) = 0
     OR position('V_ADMIN_HAS_APP_ADMIN_GRANT' IN upper(v_definition)) = 0
     OR position('AUTH.USERS' IN upper(v_definition)) = 0
     OR position('WAYONES:BULK-AD-CONTROLS:V1' IN upper(v_definition)) = 0
     OR position('FOR UPDATE' IN upper(v_definition)) = 0
     OR position('FOR SHARE' IN upper(v_definition)) = 0
     OR position('GLOBAL_PAUSED' IN v_definition) = 0
     OR position('BULK_ADS_PAUSED' IN v_definition) = 0
     OR position('BULK_ADS_RESUMED' IN v_definition) = 0
     OR position('BULK_ADS_DELETED' IN v_definition) = 0
     OR position('ALL_ADS' IN v_definition) = 0
     OR position('IS_DELETED = TRUE' IN upper(v_definition)) = 0
     OR position('ALL_ADS_PAUSED_AT' IN upper(v_definition)) = 0
     OR position('IS_EMERGENCY_FROZEN' IN upper(v_definition)) = 0
     OR position('IS_MINOR_RESTRICTED' IN upper(v_definition)) = 0
     OR position('AD_TYPE' IN upper(v_definition)) = 0
     OR position('SELL' IN upper(v_definition)) = 0
     OR position('ACCOUNT_STATUS' IN upper(v_definition)) = 0
     OR position('CANONICAL AUTH IDENTITY' IN upper(v_definition)) = 0
     OR position('UPDATE PUBLIC.ADVERTISEMENTS' IN upper(v_definition)) = 0
     OR position('UPDATE PUBLIC.P2P_ADS' IN upper(v_definition)) = 0
     OR position('UPDATE PUBLIC.ADS' IN upper(v_definition)) = 0 THEN
    RAISE EXCEPTION 'Bulk ad pause/resume/delete transaction is missing an expected security, state, store or audit guard.';
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
    RAISE EXCEPTION 'Bulk ad control RPC must remain service_role-only.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='advertisements'
       AND column_name='status' AND data_type='text' AND is_nullable='NO'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='advertisements'
       AND column_name='is_deleted' AND data_type='boolean' AND is_nullable='NO'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='advertisements'
       AND column_name='updated_at' AND data_type='timestamp with time zone'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.advertisements'::regclass
       AND conname='advertisements_status_state_check'
       AND convalidated
  ) THEN
    RAISE EXCEPTION 'Legacy advertisements status/deletion columns or their validated state constraint are missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid='public.system_settings'::regclass
       AND contype IN ('p','u')
       AND pg_get_constraintdef(oid) = 'PRIMARY KEY (key)'
  ) THEN
    RAISE EXCEPTION 'system_settings.key must remain uniquely constrained for transactional global-pause marker upserts.';
  END IF;
END;
$atomic_bulk_ad_controls_preflight$;
