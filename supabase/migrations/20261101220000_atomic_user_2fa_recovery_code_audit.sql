-- Consume user 2FA recovery codes and record the security audit event in
-- the same transaction. Never fall back to a non-audited REST mutation.
-- Local candidate only; validate against a disposable schema-faithful database.
BEGIN;

CREATE OR REPLACE FUNCTION public.consume_user_2fa_recovery_code_with_audit(
  p_user_id UUID,
  p_code_hash TEXT,
  p_context TEXT DEFAULT '2fa_verification',
  p_legacy_code_hash TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_now TIMESTAMPTZ := clock_timestamp();
  v_rows INTEGER;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Trusted user 2FA server execution required.' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL
     OR p_code_hash IS NULL OR p_code_hash !~ '^[0-9a-f]{64}$'
     OR (p_legacy_code_hash IS NOT NULL AND p_legacy_code_hash !~ '^[0-9a-f]{64}$')
     OR p_context IS NULL OR length(p_context) < 1 OR length(p_context) > 64
     OR p_context !~ '^[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'Invalid recovery-code consumption request.' USING ERRCODE = '22023';
  END IF;

  UPDATE public.user_2fa_recovery_codes
     SET used_at = v_now
   WHERE user_id = p_user_id
     AND code_hash IN (p_code_hash, p_legacy_code_hash)
     AND used_at IS NULL
     AND invalidated_at IS NULL;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RETURN false;
  END IF;
  IF v_rows <> 1 THEN
    RAISE EXCEPTION 'Recovery-code hash matched an unexpected number of rows.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.user_security_audit_logs (user_id, action, details, created_at)
  VALUES (
    p_user_id,
    '2fa_recovery_code_used',
    jsonb_build_object('context', p_context),
    v_now
  );

  RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.consume_user_2fa_recovery_code_with_audit(UUID, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_user_2fa_recovery_code_with_audit(UUID, TEXT, TEXT, TEXT)
  TO service_role, postgres;

COMMIT;
