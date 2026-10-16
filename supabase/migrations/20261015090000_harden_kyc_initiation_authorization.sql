-- Restrict KYC initiation to the authenticated profile owner and prevent direct
-- calls to the SECURITY DEFINER timeout helper from anon/authenticated clients.
CREATE OR REPLACE FUNCTION public.initiate_didit_kyc(p_user_id uuid, p_session_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_attempts INT;
  v_banned BOOLEAN;
  v_last_attempt TIMESTAMPTZ;
  v_current_status TEXT;
BEGIN
  -- Service-role backend calls may have no auth.uid(); authenticated users
  -- must only initiate KYC for their own profile.
  IF auth.uid() IS NOT NULL AND auth.uid() IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Unauthorized: KYC can only be initiated for the authenticated user.';
  END IF;

  IF auth.uid() IS NULL AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Authentication required.';
  END IF;

  IF p_user_id IS NULL OR p_session_id IS NULL OR btrim(p_session_id) = '' THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_request');
  END IF;

  PERFORM public.check_kyc_review_timeout(p_user_id);

  SELECT
    COALESCE(kyc_attempts, kyc_retry_count, 0),
    COALESCE(is_banned, false),
    kyc_last_attempt_at,
    COALESCE(kyc_status, 'none')
  INTO v_attempts, v_banned, v_last_attempt, v_current_status
  FROM public.profiles
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  IF v_banned OR v_current_status = 'banned' THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_banned');
  END IF;

  IF v_last_attempt IS NOT NULL AND v_last_attempt < (NOW() - INTERVAL '24 hours') THEN
    v_attempts := 0;
    UPDATE public.profiles
    SET kyc_attempts = 0, kyc_retry_count = 0
    WHERE id = p_user_id;
  END IF;

  IF v_current_status IN ('approved', 'VERIFIED') THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_verified');
  END IF;

  IF v_current_status IN ('in_review', 'under_review', 'PENDING_REVIEW') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'already_in_review',
      'message', 'Your verification is under review. Please wait up to 24 hours.'
    );
  END IF;

  IF v_attempts >= 3 OR v_current_status IN ('permanently_rejected', 'SUPPORT_REQUIRED') THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'max_attempts_exceeded',
      'code', 'max_attempts_exceeded',
      'message', 'Maximum KYC attempts (3/3 in 24 hours) exceeded. Please contact support.'
    );
  END IF;

  UPDATE public.profiles
  SET
    kyc_status = 'in_review',
    didit_session_id = p_session_id,
    kyc_vendor_session_id = p_session_id,
    kyc_submitted_at = NOW(),
    kyc_attempts = v_attempts + 1,
    kyc_retry_count = v_attempts + 1,
    kyc_last_attempt_at = NOW(),
    updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO public.kyc_verifications (user_id, session_id, status, vendor_data)
  VALUES (p_user_id, p_session_id, 'PENDING_REVIEW', jsonb_build_object('initiated_at', NOW(), 'attempt', v_attempts + 1));

  RETURN jsonb_build_object('success', true, 'session_id', p_session_id, 'attempts', v_attempts + 1);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.initiate_didit_kyc(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.initiate_didit_kyc(uuid, text) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.check_kyc_review_timeout(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_kyc_review_timeout(uuid) TO service_role;
