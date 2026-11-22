-- Atomically consume and rotate a one-time admin 2FA recovery password
-- while writing its mandatory audit event in the same transaction.
-- Local candidate only; validate on a disposable schema-faithful database.
BEGIN;

CREATE OR REPLACE FUNCTION public.rotate_admin_2fa_recovery_atomic(
  p_admin_id UUID,
  p_expected_recovery_hash TEXT,
  p_new_recovery_hash TEXT,
  p_admin_email TEXT,
  p_now TIMESTAMPTZ
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_rows INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Trusted administrator 2FA server execution required.' USING ERRCODE = '42501';
  END IF;
  IF p_admin_id IS NULL
     OR p_expected_recovery_hash IS NULL
     OR p_expected_recovery_hash !~ '^[0-9a-f]{64}$'
     OR p_new_recovery_hash IS NULL
     OR p_new_recovery_hash !~ '^[0-9a-f]{64}$'
     OR p_expected_recovery_hash = p_new_recovery_hash
     OR p_admin_email IS NULL
     OR length(p_admin_email) > 320
     OR p_now IS NULL THEN
    RAISE EXCEPTION 'Invalid administrator recovery rotation request.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_profile
    FROM public.profiles
   WHERE id = p_admin_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Administrator profile not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (COALESCE(v_profile.is_admin, false)
          OR COALESCE(v_profile.is_admin_account, false)
          OR LOWER(COALESCE(v_profile.role::TEXT, '')) = 'admin') THEN
    RAISE EXCEPTION 'Administrator privileges required.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_profile.is_banned, false)
     OR COALESCE(v_profile.is_suspended, false)
     OR COALESCE(v_profile.is_restricted, false)
     OR COALESCE(v_profile.is_on_hold, false)
     OR COALESCE(v_profile.is_emergency_frozen, false)
     OR COALESCE(v_profile.is_minor_restricted, false)
     OR LOWER(COALESCE(v_profile.status::TEXT, '')) IN ('banned','suspended','restricted','inactive','on_hold','hold','deleted','deletion_pending')
     OR LOWER(COALESCE(v_profile.account_status, '')) IN ('banned','suspended','restricted','inactive','on_hold','hold','deleted','deletion_pending') THEN
    RAISE EXCEPTION 'Disabled administrator cannot rotate 2FA recovery.' USING ERRCODE = '42501';
  END IF;
  IF NOT (COALESCE(v_profile.admin_2fa_enabled, false) OR COALESCE(v_profile.is_2fa_enabled, false)) THEN
    RAISE EXCEPTION 'Administrator 2FA is not enabled.' USING ERRCODE = '40001';
  END IF;
  IF v_profile.admin_2fa_recovery_hash IS DISTINCT FROM p_expected_recovery_hash THEN
    RETURN false;
  END IF;

  UPDATE public.profiles
     SET admin_2fa_recovery_hash = p_new_recovery_hash,
         admin_2fa_recovery_updated_at = p_now,
         updated_at = p_now
   WHERE id = p_admin_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Administrator recovery rotation changed an unexpected row count.' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.admin_audit_logs
    (admin_id, admin_email, action, target_id, details, created_at)
  VALUES (
    p_admin_id, p_admin_email, 'ADMIN_2FA_RECOVERY_USED', p_admin_id::text,
    jsonb_build_object('timestamp', p_now, 'rotated', true),
    p_now
  );

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.rotate_admin_2fa_recovery_atomic(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rotate_admin_2fa_recovery_atomic(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role, postgres;

COMMIT;
