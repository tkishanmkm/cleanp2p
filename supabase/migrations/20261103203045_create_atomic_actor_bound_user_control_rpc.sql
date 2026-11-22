BEGIN;

CREATE OR REPLACE FUNCTION public.admin_update_user_control(
  p_admin_id uuid,
  p_target_user_id uuid,
  p_action text,
  p_reason text,
  p_locked boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_action text := lower(pg_catalog.btrim(coalesce(p_action, '')));
  v_reason text := pg_catalog.btrim(coalesce(p_reason, ''));
  v_admin_email text;
  v_audit_action text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Service role required'
      USING ERRCODE = '42501';
  END IF;

  IF p_admin_id IS NULL OR p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Administrator and target user identifiers are required'
      USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_active_admin_identity(p_admin_id) THEN
    RAISE EXCEPTION 'A provisioned active administrator is required'
      USING ERRCODE = '42501';
  END IF;

  IF p_admin_id = p_target_user_id THEN
    RAISE EXCEPTION 'Administrators cannot change these controls on their own account'
      USING ERRCODE = '42501';
  END IF;

  IF pg_catalog.length(v_reason) < 3 OR pg_catalog.length(v_reason) > 500 THEN
    RAISE EXCEPTION 'A reason between 3 and 500 characters is required'
      USING ERRCODE = '22023';
  END IF;

  IF v_action NOT IN (
    'reset_kyc',
    'verify_kyc',
    'unverify_kyc',
    'toggle_withdrawal'
  ) THEN
    RAISE EXCEPTION 'Unsupported user control action'
      USING ERRCODE = '22023';
  END IF;

  IF v_action = 'toggle_withdrawal' AND p_locked IS NULL THEN
    RAISE EXCEPTION 'Withdrawal lock state is required'
      USING ERRCODE = '22023';
  END IF;

  PERFORM 1
  FROM public.profiles p
  WHERE p.id = p_target_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT NULLIF(pg_catalog.btrim(u.email), '')
    INTO v_admin_email
  FROM auth.users u
  WHERE u.id = p_admin_id;

  IF v_action = 'reset_kyc' THEN
    UPDATE public.profiles
    SET kyc_status = 'NOT_SUBMITTED',
        is_verified = false,
        id_verified = false,
        is_id_verified = false,
        kyc_attempts = 0,
        verification_tier = '1',
        kyc_vendor_session_id = NULL,
        kyc_retry_after = NULL,
        is_kyc_locked = false,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = p_target_user_id;
    v_audit_action := 'RESET_USER_KYC';

  ELSIF v_action = 'verify_kyc' THEN
    UPDATE public.profiles
    SET kyc_status = 'VERIFIED',
        is_verified = true,
        id_verified = true,
        is_id_verified = true,
        verification_tier = '2',
        is_kyc_locked = false,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = p_target_user_id;
    v_audit_action := 'FORCE_VERIFY_KYC';

  ELSIF v_action = 'unverify_kyc' THEN
    UPDATE public.profiles
    SET kyc_status = 'UNVERIFIED',
        is_verified = false,
        id_verified = false,
        is_id_verified = false,
        verification_tier = '1',
        is_kyc_locked = false,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = p_target_user_id;
    v_audit_action := 'FORCE_UNVERIFY_KYC';

  ELSE
    UPDATE public.profiles
    SET is_withdrawal_locked = p_locked,
        withdrawals_disabled = p_locked,
        updated_at = pg_catalog.clock_timestamp()
    WHERE id = p_target_user_id;
    v_audit_action := CASE
      WHEN p_locked THEN 'LOCK_USER_WITHDRAWAL'
      ELSE 'UNLOCK_USER_WITHDRAWAL'
    END;
  END IF;

  INSERT INTO public.admin_audit_logs (
    admin_id, admin_email, action, target_user_id, details, created_at
  )
  VALUES (
    p_admin_id,
    v_admin_email,
    v_audit_action,
    p_target_user_id,
    pg_catalog.jsonb_build_object(
      'reason', v_reason,
      'action', v_action,
      'locked', CASE WHEN v_action = 'toggle_withdrawal' THEN p_locked ELSE NULL END
    ),
    pg_catalog.clock_timestamp()
  );

  RETURN pg_catalog.jsonb_build_object(
    'success', true,
    'target_user_id', p_target_user_id,
    'action', v_action,
    'locked', CASE WHEN v_action = 'toggle_withdrawal' THEN p_locked ELSE NULL END
  );
END;
$function$;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.admin_update_user_control(uuid,uuid,text,text,boolean)
  FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
  ON FUNCTION public.admin_update_user_control(uuid,uuid,text,text,boolean)
  TO service_role;

COMMIT;
