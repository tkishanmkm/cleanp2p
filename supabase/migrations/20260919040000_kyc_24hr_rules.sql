-- ==============================================================================
-- Migration: 20260919040000_kyc_24hr_rules.sql
-- Purpose: Enforce 24-hr under-review timeout, 3-attempt rolling limit per 24 hours,
--          auto-removal of "Under Review" if Didit does not respond within 24 hours,
--          and approval/rejection sync logic.
-- ==============================================================================

-- 1. Function to check and expire stale 'in_review' status (> 24 hours with no response)
CREATE OR REPLACE FUNCTION public.check_kyc_review_timeout(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_submitted TIMESTAMPTZ;
BEGIN
  SELECT kyc_status, kyc_submitted_at
  INTO v_status, v_submitted
  FROM public.profiles
  WHERE id = p_user_id;

  -- If status is in_review or under_review and submitted > 24 hours ago without response
  IF v_status IN ('in_review', 'under_review', 'PENDING_REVIEW') AND v_submitted IS NOT NULL AND v_submitted < (NOW() - INTERVAL '24 hours') THEN
    UPDATE public.profiles
    SET 
      kyc_status = 'not_started',
      didit_session_id = NULL,
      kyc_vendor_session_id = NULL,
      updated_at = NOW()
    WHERE id = p_user_id;
    
    RETURN 'not_started';
  END IF;

  RETURN COALESCE(v_status, 'not_started');
END;
$$;

-- 2. Enhanced initiate_didit_kyc RPC with 24-hour rolling reset and 3-attempt limit
DROP FUNCTION IF EXISTS public.initiate_didit_kyc(UUID, TEXT) CASCADE;
CREATE OR REPLACE FUNCTION public.initiate_didit_kyc(
  p_user_id UUID,
  p_session_id TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_attempts INT;
  v_banned BOOLEAN;
  v_last_attempt TIMESTAMPTZ;
  v_current_status TEXT;
  v_submitted TIMESTAMPTZ;
BEGIN
  -- First check and clean up stale review timeout (> 24 hours)
  PERFORM public.check_kyc_review_timeout(p_user_id);

  SELECT 
    COALESCE(kyc_attempts, kyc_retry_count, 0),
    COALESCE(is_banned, false),
    kyc_last_attempt_at,
    COALESCE(kyc_status, 'none'),
    kyc_submitted_at
  INTO v_attempts, v_banned, v_last_attempt, v_current_status, v_submitted
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  IF v_banned OR v_current_status = 'banned' THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_banned');
  END IF;

  -- 24-hour rolling reset for attempts
  IF v_last_attempt IS NOT NULL AND v_last_attempt < (NOW() - INTERVAL '24 hours') THEN
    v_attempts := 0;
    UPDATE public.profiles
    SET kyc_attempts = 0, kyc_retry_count = 0
    WHERE id = p_user_id;
  END IF;

  -- If already approved, do not re-initiate
  IF v_current_status IN ('approved', 'VERIFIED') THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_verified', 'message', 'Account is already verified.');
  END IF;

  -- If currently in review and not timed out yet
  IF v_current_status IN ('in_review', 'under_review', 'PENDING_REVIEW') THEN
    RETURN jsonb_build_object(
      'success', false, 
      'error', 'already_in_review', 
      'message', 'Your verification is currently under review. Please wait up to 24 hours.'
    );
  END IF;

  IF v_attempts >= 3 OR v_current_status = 'permanently_rejected' OR v_current_status = 'SUPPORT_REQUIRED' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'max_attempts_exceeded',
      'code', 'max_attempts_exceeded',
      'message', 'Maximum KYC attempts (3/3 in 24 hours) exceeded. Please contact support.'
    );
  END IF;

  -- Record session initiation & increment attempt count
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
$$;
