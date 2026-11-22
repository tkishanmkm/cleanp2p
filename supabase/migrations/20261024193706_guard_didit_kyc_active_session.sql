-- Guard Didit decision application against stale or mismatched sessions.
-- This migration only replaces the RPC definition; it does not execute against any database.
CREATE OR REPLACE FUNCTION public.sync_didit_kyc_status(
  p_user_id UUID,
  p_status TEXT,
  p_session_id TEXT,
  p_decision JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_didit_session_id TEXT;
  v_vendor_session_id TEXT;
  v_verification_user_id UUID;
  v_new_retries INT;
  v_last_attempt TIMESTAMPTZ;
  v_curr_attempts INT;
  v_status TEXT := lower(coalesce(p_status, ''));
BEGIN
  IF p_user_id IS NULL OR nullif(trim(p_session_id), '') IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_session');
  END IF;

  -- Serialize decisions for this profile and prevent an old session overwriting a newer one.
  SELECT p.didit_session_id, p.kyc_vendor_session_id
    INTO v_didit_session_id, v_vendor_session_id
  FROM public.profiles AS p
  WHERE p.id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  IF v_didit_session_id IS DISTINCT FROM p_session_id
     AND v_vendor_session_id IS DISTINCT FROM p_session_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'stale_session');
  END IF;

  -- Bind the session to the same user in the verification ledger as a second guard.
  SELECT kv.user_id INTO v_verification_user_id
  FROM public.kyc_verifications AS kv
  WHERE kv.session_id = p_session_id
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND OR v_verification_user_id IS DISTINCT FROM p_user_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'stale_session');
  END IF;

  IF v_status IN ('approved', 'completed', 'passed') THEN
    UPDATE public.profiles
    SET kyc_status = 'approved',
        id_verified = true,
        is_verified = true,
        is_kyc_locked = true,
        kyc_approved_at = NOW(),
        updated_at = NOW()
    WHERE id = p_user_id;

    UPDATE public.kyc_verifications
    SET status = 'APPROVED', decision = coalesce(p_decision, '{}'::jsonb), updated_at = NOW()
    WHERE session_id = p_session_id AND user_id = p_user_id;

    RETURN jsonb_build_object('success', true, 'status', 'approved');

  ELSIF v_status IN ('in_review', 'pending', 'submitted', 'pending_review') THEN
    UPDATE public.profiles
    SET kyc_status = 'in_review', updated_at = NOW()
    WHERE id = p_user_id;

    UPDATE public.kyc_verifications
    SET status = 'PENDING_REVIEW', decision = coalesce(p_decision, '{}'::jsonb), updated_at = NOW()
    WHERE session_id = p_session_id AND user_id = p_user_id;

    RETURN jsonb_build_object('success', true, 'status', 'in_review');

  ELSIF v_status IN ('declined', 'rejected', 'failed') THEN
    SELECT p.kyc_last_attempt_at,
           coalesce(p.kyc_attempts, p.kyc_retry_count, 0)
      INTO v_last_attempt, v_curr_attempts
    FROM public.profiles AS p
    WHERE p.id = p_user_id;

    IF v_last_attempt IS NOT NULL AND v_last_attempt < (NOW() - INTERVAL '24 hours') THEN
      v_new_retries := 1;
    ELSE
      v_new_retries := coalesce(v_curr_attempts, 0) + 1;
    END IF;

    IF v_new_retries >= 3 THEN
      UPDATE public.profiles
      SET kyc_status = 'permanently_rejected',
          kyc_retry_count = v_new_retries,
          kyc_attempts = v_new_retries,
          kyc_last_attempt_at = NOW(),
          is_kyc_locked = true,
          suspension_reason = 'KYC failed 3 consecutive times in 24 hours. Contact support for manual assistance.',
          updated_at = NOW()
      WHERE id = p_user_id;

      UPDATE public.kyc_verifications
      SET status = 'SUPPORT_REQUIRED', decision = coalesce(p_decision, '{}'::jsonb), updated_at = NOW()
      WHERE session_id = p_session_id AND user_id = p_user_id;

      RETURN jsonb_build_object('success', true, 'status', 'permanently_rejected', 'attempts', v_new_retries);
    END IF;

    UPDATE public.profiles
    SET kyc_status = 'declined',
        kyc_retry_count = v_new_retries,
        kyc_attempts = v_new_retries,
        kyc_last_attempt_at = NOW(),
        updated_at = NOW()
    WHERE id = p_user_id;

    UPDATE public.kyc_verifications
    SET status = 'DECLINED', decision = coalesce(p_decision, '{}'::jsonb), updated_at = NOW()
    WHERE session_id = p_session_id AND user_id = p_user_id;

    RETURN jsonb_build_object('success', true, 'status', 'declined', 'attempts', v_new_retries);
  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'unsupported_status');
  END IF;
END;
$$;
