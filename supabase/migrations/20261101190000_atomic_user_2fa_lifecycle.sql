-- Transactional user 2FA enrollment/rotation and disable lifecycle.
-- Only the trusted application server can invoke these SECURITY DEFINER RPCs.
-- Local candidate only. Validate on a disposable schema-faithful database.
BEGIN;

CREATE OR REPLACE FUNCTION public.enable_user_2fa_atomic(
  p_user_id UUID,
  p_encrypted_secret TEXT,
  p_recovery_code_hashes JSONB,
  p_is_rotation BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_pending public.user_2fa_pending_enrollments%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_hash_count INTEGER;
  v_distinct_hash_count INTEGER;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_rows INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Trusted user 2FA server execution required.' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL
     OR p_encrypted_secret IS NULL
     OR length(p_encrypted_secret) < 40
     OR length(p_encrypted_secret) > 4096
     OR p_encrypted_secret NOT LIKE 'v1:enc:%'
     OR p_is_rotation IS NULL
     OR jsonb_typeof(p_recovery_code_hashes) <> 'array' THEN
    RAISE EXCEPTION 'Invalid user 2FA enrollment request.' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_profile
    FROM public.profiles
   WHERE id = p_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile does not exist.' USING ERRCODE = 'P0002';
  END IF;

  IF p_is_rotation IS DISTINCT FROM (
    COALESCE(v_profile.is_2fa_enabled, false)
    OR COALESCE(v_profile.is_mfa_enabled, false)
    OR COALESCE(v_profile.two_factor_enabled, false)
  ) THEN
    RAISE EXCEPTION 'User 2FA state changed during enrollment.' USING ERRCODE = '40001';
  END IF;

  SELECT *
    INTO v_pending
    FROM public.user_2fa_pending_enrollments
   WHERE user_id = p_user_id
     AND encrypted_secret = p_encrypted_secret
     AND expires_at > v_now
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pending user 2FA enrollment is missing, expired, or changed.' USING ERRCODE = '40001';
  END IF;

  SELECT COUNT(*), COUNT(DISTINCT value)
    INTO v_hash_count, v_distinct_hash_count
    FROM jsonb_array_elements_text(p_recovery_code_hashes) AS item(value)
   WHERE value ~ '^[0-9a-f]{64}$';
  IF v_hash_count <> 8 OR v_distinct_hash_count <> 8
     OR jsonb_array_length(p_recovery_code_hashes) <> 8 THEN
    RAISE EXCEPTION 'Exactly eight unique SHA-256 recovery-code hashes are required.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
     SET is_2fa_enabled = true,
         is_mfa_enabled = true,
         two_factor_enabled = true,
         totp_secret = p_encrypted_secret,
         two_factor_secret = p_encrypted_secret,
         updated_at = v_now
   WHERE id = p_user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'User profile 2FA update did not affect exactly one row.' USING ERRCODE = '40001';
  END IF;

  UPDATE public.user_2fa_recovery_codes
     SET invalidated_at = v_now
   WHERE user_id = p_user_id
     AND invalidated_at IS NULL;

  INSERT INTO public.user_2fa_recovery_codes (user_id, code_hash, created_at)
  SELECT p_user_id, item.value, v_now
    FROM jsonb_array_elements_text(p_recovery_code_hashes) AS item(value);

  DELETE FROM public.user_2fa_pending_enrollments
   WHERE user_id = p_user_id;

  INSERT INTO public.user_security_audit_logs (user_id, action, details, created_at)
  VALUES (
    p_user_id,
    CASE WHEN p_is_rotation THEN '2fa_rotation_successful' ELSE '2fa_enabled' END,
    jsonb_build_object('recovery_code_count', 8),
    v_now
  );

  RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.disable_user_2fa_atomic(
  p_user_id UUID,
  p_recovery_code_hash TEXT DEFAULT NULL,
  p_method TEXT DEFAULT 'totp',
  p_legacy_code_hash TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_now TIMESTAMPTZ := clock_timestamp();
  v_rows INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Trusted user 2FA server execution required.' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL
     OR p_method NOT IN ('totp', 'recovery_code')
     OR (p_method = 'recovery_code' AND (
       (p_recovery_code_hash IS NULL OR p_recovery_code_hash !~ '^[0-9a-f]{64}$')
       OR (p_legacy_code_hash IS NOT NULL AND p_legacy_code_hash !~ '^[0-9a-f]{64}$')
     ))
     OR (p_method = 'totp' AND (p_recovery_code_hash IS NOT NULL OR p_legacy_code_hash IS NOT NULL)) THEN
    RAISE EXCEPTION 'Invalid user 2FA disable request.' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_profile
    FROM public.profiles
   WHERE id = p_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile does not exist.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT (
    COALESCE(v_profile.is_2fa_enabled, false)
    OR COALESCE(v_profile.is_mfa_enabled, false)
    OR COALESCE(v_profile.two_factor_enabled, false)
  ) THEN
    RAISE EXCEPTION 'User 2FA is not enabled.' USING ERRCODE = '40001';
  END IF;

  IF p_method = 'recovery_code' THEN
    UPDATE public.user_2fa_recovery_codes
       SET used_at = v_now
     WHERE user_id = p_user_id
       AND code_hash IN (p_recovery_code_hash, p_legacy_code_hash)
       AND used_at IS NULL
       AND invalidated_at IS NULL;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows <> 1 THEN
      RETURN false;
    END IF;
  END IF;

  UPDATE public.profiles
     SET is_2fa_enabled = false,
         is_mfa_enabled = false,
         two_factor_enabled = false,
         totp_secret = NULL,
         two_factor_secret = NULL,
         updated_at = v_now
   WHERE id = p_user_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'User profile 2FA disable did not affect exactly one row.' USING ERRCODE = '40001';
  END IF;

  UPDATE public.user_2fa_recovery_codes
     SET invalidated_at = v_now
   WHERE user_id = p_user_id
     AND invalidated_at IS NULL;

  DELETE FROM public.user_2fa_pending_enrollments
   WHERE user_id = p_user_id;

  INSERT INTO public.user_security_audit_logs (user_id, action, details, created_at)
  VALUES (
    p_user_id,
    '2fa_disabled',
    jsonb_build_object('method', p_method),
    v_now
  );

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.enable_user_2fa_atomic(UUID, TEXT, JSONB, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.disable_user_2fa_atomic(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enable_user_2fa_atomic(UUID, TEXT, JSONB, BOOLEAN) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.disable_user_2fa_atomic(UUID, TEXT, TEXT, TEXT) TO service_role, postgres;

COMMIT;
