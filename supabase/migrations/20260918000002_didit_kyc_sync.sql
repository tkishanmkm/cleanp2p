-- Migration: 20260918000002_didit_kyc_sync.sql
-- Description: Complete Didit KYC table columns, indexes, RLS policies, and sync functions

-- 1. Ensure all Didit KYC columns exist on public.profiles
ALTER TABLE public.profiles 
  ADD COLUMN IF NOT EXISTS kyc_status TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS didit_session_id TEXT,
  ADD COLUMN IF NOT EXISTS kyc_vendor_session_id TEXT,
  ADD COLUMN IF NOT EXISTS id_document_number TEXT,
  ADD COLUMN IF NOT EXISTS is_kyc_locked BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_country_locked BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS dob DATE,
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS id_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS kyc_retry_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kyc_attempts INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS kyc_last_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_documents_b2_key TEXT;

-- Index for quick lookup during webhook callbacks
CREATE INDEX IF NOT EXISTS idx_profiles_didit_session_id ON public.profiles(didit_session_id);
CREATE INDEX IF NOT EXISTS idx_profiles_kyc_status ON public.profiles(kyc_status);
CREATE INDEX IF NOT EXISTS idx_profiles_id_document_number ON public.profiles(id_document_number);

-- 2. Create or enhance public.kyc_verifications table
CREATE TABLE IF NOT EXISTS public.kyc_verifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  session_id TEXT,
  status TEXT DEFAULT 'PENDING_REVIEW',
  vendor_data JSONB DEFAULT '{}'::jsonb,
  decision JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kyc_verifications_user_id ON public.kyc_verifications(user_id);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_session_id ON public.kyc_verifications(session_id);
CREATE INDEX IF NOT EXISTS idx_kyc_verifications_status ON public.kyc_verifications(status);

-- Enable RLS
ALTER TABLE public.kyc_verifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies
DROP POLICY IF EXISTS "Users can view own kyc verifications" ON public.kyc_verifications;
CREATE POLICY "Users can view own kyc verifications"
  ON public.kyc_verifications
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Service role full access to kyc_verifications" ON public.kyc_verifications;
CREATE POLICY "Service role full access to kyc_verifications"
  ON public.kyc_verifications
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. Atomic RPC helper to initiate Didit session
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
BEGIN
  SELECT COALESCE(kyc_attempts, kyc_retry_count, 0), COALESCE(is_banned, false), kyc_last_attempt_at
  INTO v_attempts, v_banned, v_last_attempt
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  IF v_banned THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_banned');
  END IF;

  -- 24-hour rolling reset check
  IF v_last_attempt IS NOT NULL AND v_last_attempt < (NOW() - INTERVAL '24 hours') THEN
    v_attempts := 0;
  END IF;

  IF v_attempts >= 3 THEN
    RETURN jsonb_build_object('success', false, 'error', 'max_attempts_exceeded');
  END IF;

  -- Set status to in_review
  UPDATE public.profiles
  SET 
    kyc_status = 'in_review',
    didit_session_id = p_session_id,
    kyc_vendor_session_id = p_session_id,
    kyc_submitted_at = NOW(),
    updated_at = NOW()
  WHERE id = p_user_id;

  -- Insert verification record
  INSERT INTO public.kyc_verifications (user_id, session_id, status, created_at, updated_at)
  VALUES (p_user_id, p_session_id, 'PENDING_REVIEW', NOW(), NOW());

  RETURN jsonb_build_object('success', true, 'status', 'in_review');
END;
$$;

-- 4. Atomic RPC helper to sync Didit verification decision
DROP FUNCTION IF EXISTS public.sync_didit_kyc_status(UUID, TEXT, TEXT, JSONB) CASCADE;
CREATE OR REPLACE FUNCTION public.sync_didit_kyc_status(
  p_user_id UUID,
  p_status TEXT,
  p_session_id TEXT,
  p_decision JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_retries INT;
BEGIN
  IF lower(p_status) IN ('approved', 'completed', 'passed') THEN
    UPDATE public.profiles
    SET 
      kyc_status = 'approved',
      id_verified = true,
      is_verified = true,
      is_kyc_locked = true,
      kyc_approved_at = NOW(),
      updated_at = NOW()
    WHERE id = p_user_id;

    IF p_session_id IS NOT NULL THEN
      UPDATE public.kyc_verifications
      SET status = 'APPROVED', decision = p_decision, updated_at = NOW()
      WHERE session_id = p_session_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'approved');

  ELSIF lower(p_status) IN ('in_review', 'pending', 'submitted', 'pending_review') THEN
    UPDATE public.profiles
    SET 
      kyc_status = 'in_review',
      updated_at = NOW()
    WHERE id = p_user_id;

    IF p_session_id IS NOT NULL THEN
      UPDATE public.kyc_verifications
      SET status = 'PENDING_REVIEW', decision = p_decision, updated_at = NOW()
      WHERE session_id = p_session_id;
    END IF;

    RETURN jsonb_build_object('success', true, 'status', 'in_review');

  ELSE
    -- Declined / Rejected handling with 3-attempt limit per 24 hours
    DECLARE
      v_last_attempt TIMESTAMPTZ;
      v_curr_attempts INT;
    BEGIN
      SELECT kyc_last_attempt_at, COALESCE(kyc_attempts, kyc_retry_count, 0)
      INTO v_last_attempt, v_curr_attempts
      FROM public.profiles
      WHERE id = p_user_id;

      IF v_last_attempt IS NOT NULL AND v_last_attempt < (NOW() - INTERVAL '24 hours') THEN
        v_new_retries := 1;
      ELSE
        v_new_retries := v_curr_attempts + 1;
      END IF;
    END;

    IF v_new_retries >= 3 THEN
      UPDATE public.profiles
      SET 
        kyc_status = 'permanently_rejected',
        kyc_retry_count = v_new_retries,
        kyc_attempts = v_new_retries,
        kyc_last_attempt_at = NOW(),
        is_kyc_locked = true,
        suspension_reason = 'KYC failed 3 consecutive times in 24 hours. Contact support for manual assistance.',
        updated_at = NOW()
      WHERE id = p_user_id;

      IF p_session_id IS NOT NULL THEN
        UPDATE public.kyc_verifications
        SET status = 'SUPPORT_REQUIRED', decision = p_decision, updated_at = NOW()
        WHERE session_id = p_session_id;
      END IF;

      RETURN jsonb_build_object('success', true, 'status', 'permanently_rejected', 'attempts', v_new_retries);
    ELSE
      UPDATE public.profiles
      SET 
        kyc_status = 'declined',
        kyc_retry_count = v_new_retries,
        kyc_attempts = v_new_retries,
        kyc_last_attempt_at = NOW(),
        updated_at = NOW()
      WHERE id = p_user_id;

      IF p_session_id IS NOT NULL THEN
        UPDATE public.kyc_verifications
        SET status = 'DECLINED', decision = p_decision, updated_at = NOW()
        WHERE session_id = p_session_id;
      END IF;

      RETURN jsonb_build_object('success', true, 'status', 'declined', 'attempts', v_new_retries);
    END IF;
  END IF;
END;
$$;
