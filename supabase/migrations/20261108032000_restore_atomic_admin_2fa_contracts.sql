-- Forward restoration of atomic, actor-bound administrator 2FA lifecycle.
-- Every operation uses canonical admin resolution and locked account state.
BEGIN;
CREATE OR REPLACE FUNCTION public.enable_admin_2fa_atomic(
  p_admin_id UUID,
  p_expected_encrypted_secret TEXT,
  p_admin_email TEXT,
  p_recovery_hash TEXT,
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
     OR p_expected_encrypted_secret IS NULL
     OR p_expected_encrypted_secret NOT LIKE 'v1:enc:%'
     OR p_admin_email IS NULL
     OR length(p_admin_email) > 320
     OR p_recovery_hash IS NULL OR p_recovery_hash !~ '^[0-9a-f]{64}$'
     OR p_now IS NULL THEN
    RAISE EXCEPTION 'Invalid administrator 2FA enable request.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_profile
    FROM public.profiles
   WHERE id = p_admin_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Administrator profile not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.verify_admin_login(p_admin_id, NULL) AS admin_check
    WHERE admin_check.is_valid IS TRUE
      AND COALESCE(admin_check.suspended_val, false) IS FALSE
  ) THEN
    RAISE EXCEPTION 'Canonical active administrator authorization is required.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_profile.is_banned, false)
     OR COALESCE(v_profile.is_suspended, false)
     OR COALESCE(v_profile.is_restricted, false)
     OR COALESCE(v_profile.is_on_hold, false)
     OR COALESCE(v_profile.is_emergency_frozen, false)
     OR COALESCE(v_profile.is_minor_restricted, false)
     OR LOWER(COALESCE(v_profile.status::TEXT, '')) <> 'active'
     OR (v_profile.account_status IS NOT NULL AND LOWER(v_profile.account_status) <> 'active') THEN
    RAISE EXCEPTION 'Disabled administrator cannot change 2FA.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_profile.admin_2fa_enabled, false)
     OR COALESCE(v_profile.is_2fa_enabled, false) THEN
    RAISE EXCEPTION 'Administrator 2FA is already enabled.' USING ERRCODE = '40001';
  END IF;
  IF COALESCE(v_profile.admin_2fa_secret, v_profile.two_factor_secret)
     IS DISTINCT FROM p_expected_encrypted_secret THEN
    RAISE EXCEPTION 'Pending administrator authenticator changed.' USING ERRCODE = '40001';
  END IF;

  UPDATE public.profiles
     SET admin_2fa_enabled = true,
         is_2fa_enabled = true,
         is_mfa_enabled = true,
         admin_2fa_secret = p_expected_encrypted_secret,
         two_factor_secret = p_expected_encrypted_secret,
         admin_2fa_recovery_hash = p_recovery_hash,
         admin_2fa_recovery_updated_at = p_now,
         updated_at = p_now
   WHERE id = p_admin_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Administrator 2FA enable changed an unexpected row count.' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.admin_audit_logs
    (admin_id, admin_email, action, target_id, details, created_at)
  VALUES (
    p_admin_id, p_admin_email, 'ADMIN_2FA_ENABLED', p_admin_id::text,
    jsonb_build_object('recovery_password_generated', true, 'timestamp', p_now),
    p_now
  );

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.disable_admin_2fa_atomic(
  p_admin_id UUID,
  p_expected_encrypted_secret TEXT,
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
     OR p_expected_encrypted_secret IS NULL
     OR p_admin_email IS NULL
     OR length(p_admin_email) > 320
     OR p_now IS NULL THEN
    RAISE EXCEPTION 'Invalid administrator 2FA disable request.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_profile
    FROM public.profiles
   WHERE id = p_admin_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Administrator profile not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.verify_admin_login(p_admin_id, NULL) AS admin_check
    WHERE admin_check.is_valid IS TRUE
      AND COALESCE(admin_check.suspended_val, false) IS FALSE
  ) THEN
    RAISE EXCEPTION 'Canonical active administrator authorization is required.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_profile.is_banned, false)
     OR COALESCE(v_profile.is_suspended, false)
     OR COALESCE(v_profile.is_restricted, false)
     OR COALESCE(v_profile.is_on_hold, false)
     OR COALESCE(v_profile.is_emergency_frozen, false)
     OR COALESCE(v_profile.is_minor_restricted, false)
     OR LOWER(COALESCE(v_profile.status::TEXT, '')) <> 'active'
     OR (v_profile.account_status IS NOT NULL AND LOWER(v_profile.account_status) <> 'active') THEN
    RAISE EXCEPTION 'Disabled administrator cannot change 2FA.' USING ERRCODE = '42501';
  END IF;
  IF NOT (COALESCE(v_profile.admin_2fa_enabled, false) OR COALESCE(v_profile.is_2fa_enabled, false)) THEN
    RAISE EXCEPTION 'Administrator 2FA is not enabled.' USING ERRCODE = '40001';
  END IF;
  IF COALESCE(v_profile.admin_2fa_secret, v_profile.two_factor_secret)
     IS DISTINCT FROM p_expected_encrypted_secret THEN
    RAISE EXCEPTION 'Administrator authenticator changed.' USING ERRCODE = '40001';
  END IF;

  UPDATE public.profiles
     SET admin_2fa_enabled = false,
         is_2fa_enabled = false,
         is_mfa_enabled = false,
         admin_2fa_secret = NULL,
         two_factor_secret = NULL,
         admin_2fa_recovery_hash = NULL,
         admin_2fa_recovery_updated_at = p_now,
         updated_at = p_now
   WHERE id = p_admin_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Administrator 2FA disable changed an unexpected row count.' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.admin_audit_logs
    (admin_id, admin_email, action, target_id, details, created_at)
  VALUES (
    p_admin_id, p_admin_email, 'ADMIN_2FA_DISABLED', p_admin_id::text,
    jsonb_build_object('method_used', 'totp_code', 'timestamp', p_now),
    p_now
  );

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recover_admin_2fa_atomic(
  p_admin_id UUID,
  p_expected_recovery_hash TEXT,
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
     OR p_admin_email IS NULL
     OR length(p_admin_email) > 320
     OR p_now IS NULL THEN
    RAISE EXCEPTION 'Invalid administrator 2FA recovery request.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_profile
    FROM public.profiles
   WHERE id = p_admin_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Administrator profile not found.' USING ERRCODE = 'P0002';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.verify_admin_login(p_admin_id, NULL) AS admin_check
    WHERE admin_check.is_valid IS TRUE
      AND COALESCE(admin_check.suspended_val, false) IS FALSE
  ) THEN
    RAISE EXCEPTION 'Canonical active administrator authorization is required.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_profile.is_banned, false)
     OR COALESCE(v_profile.is_suspended, false)
     OR COALESCE(v_profile.is_restricted, false)
     OR COALESCE(v_profile.is_on_hold, false)
     OR COALESCE(v_profile.is_emergency_frozen, false)
     OR COALESCE(v_profile.is_minor_restricted, false)
     OR LOWER(COALESCE(v_profile.status::TEXT, '')) <> 'active'
     OR (v_profile.account_status IS NOT NULL AND LOWER(v_profile.account_status) <> 'active') THEN
    RAISE EXCEPTION 'Disabled administrator cannot change 2FA.' USING ERRCODE = '42501';
  END IF;
  IF v_profile.admin_2fa_recovery_hash IS DISTINCT FROM p_expected_recovery_hash THEN
    RETURN false;
  END IF;

  UPDATE public.profiles
     SET admin_2fa_enabled = false,
         is_2fa_enabled = false,
         is_mfa_enabled = false,
         admin_2fa_secret = NULL,
         two_factor_secret = NULL,
         admin_2fa_recovery_hash = NULL,
         admin_2fa_recovery_updated_at = p_now,
         updated_at = p_now
   WHERE id = p_admin_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Administrator 2FA recovery changed an unexpected row count.' USING ERRCODE = '40001';
  END IF;

  INSERT INTO public.admin_audit_logs
    (admin_id, admin_email, action, target_id, details, created_at)
  VALUES (
    p_admin_id, p_admin_email, 'ADMIN_2FA_RECOVERY_USED', p_admin_id::text,
    jsonb_build_object('timestamp', p_now),
    p_now
  );

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.enable_admin_2fa_atomic(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.disable_admin_2fa_atomic(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recover_admin_2fa_atomic(UUID, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enable_admin_2fa_atomic(UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.disable_admin_2fa_atomic(UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.recover_admin_2fa_atomic(UUID, TEXT, TEXT, TIMESTAMPTZ) TO service_role, postgres;

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
  IF NOT EXISTS (
    SELECT 1
    FROM public.verify_admin_login(p_admin_id, NULL) AS admin_check
    WHERE admin_check.is_valid IS TRUE
      AND COALESCE(admin_check.suspended_val, false) IS FALSE
  ) THEN
    RAISE EXCEPTION 'Canonical active administrator authorization is required.' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(v_profile.is_banned, false)
     OR COALESCE(v_profile.is_suspended, false)
     OR COALESCE(v_profile.is_restricted, false)
     OR COALESCE(v_profile.is_on_hold, false)
     OR COALESCE(v_profile.is_emergency_frozen, false)
     OR COALESCE(v_profile.is_minor_restricted, false)
     OR LOWER(COALESCE(v_profile.status::TEXT, '')) <> 'active'
     OR (v_profile.account_status IS NOT NULL AND LOWER(v_profile.account_status) <> 'active') THEN
    RAISE EXCEPTION 'Disabled administrator cannot change 2FA.' USING ERRCODE = '42501';
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

ALTER FUNCTION public.enable_admin_2fa_atomic(uuid, text, text, text, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.disable_admin_2fa_atomic(uuid, text, text, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.recover_admin_2fa_atomic(uuid, text, text, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.rotate_admin_2fa_recovery_atomic(uuid, text, text, text, timestamptz) OWNER TO postgres;
COMMIT;
