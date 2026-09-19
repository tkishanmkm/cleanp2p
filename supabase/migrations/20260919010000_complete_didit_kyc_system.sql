-- ==============================================================================
-- Migration: 20260919010000_complete_didit_kyc_system.sql
-- Description: Complete Idempotent Schema, Columns, Indexes, RLS and RPCs for Didit KYC
-- ==============================================================================

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

-- 2. Indexes for fast webhook lookup and duplicate checks
CREATE INDEX IF NOT EXISTS idx_profiles_didit_session_id ON public.profiles(didit_session_id);
CREATE INDEX IF NOT EXISTS idx_profiles_kyc_vendor_session_id ON public.profiles(kyc_vendor_session_id);
CREATE INDEX IF NOT EXISTS idx_profiles_kyc_status ON public.profiles(kyc_status);
CREATE INDEX IF NOT EXISTS idx_profiles_id_document_number ON public.profiles(id_document_number);

-- 3. Create or enhance public.kyc_verifications table for audit logging
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

-- 4. Enable RLS and Configure Policies
ALTER TABLE public.kyc_verifications ENABLE ROW LEVEL SECURITY;

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

-- 5. Helper RPC to initiate session with 24-hour rolling reset
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
BEGIN
  SELECT 
    COALESCE(kyc_attempts, kyc_retry_count, 0),
    COALESCE(is_banned, false),
    kyc_last_attempt_at,
    COALESCE(kyc_status, 'none')
  INTO v_attempts, v_banned, v_last_attempt, v_current_status
  FROM public.profiles
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  IF v_banned OR v_current_status = 'banned' THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_banned');
  END IF;

  -- 24-hour rolling reset
  IF v_last_attempt IS NOT NULL AND v_last_attempt < (NOW() - INTERVAL '24 hours') THEN
    v_attempts := 0;
  END IF;

  IF v_attempts >= 3 OR v_current_status = 'permanently_rejected' OR v_current_status = 'SUPPORT_REQUIRED' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'max_attempts_exceeded',
      'code', 'max_attempts_exceeded',
      'message', 'Maximum KYC attempts (3/3 in 24 hours) exceeded. Please contact support.'
    );
  END IF;

  -- Record session initiation
  UPDATE public.profiles
  SET 
    kyc_status = 'in_review',
    didit_session_id = p_session_id,
    kyc_vendor_session_id = p_session_id,
    kyc_submitted_at = NOW(),
    updated_at = NOW()
  WHERE id = p_user_id;

  INSERT INTO public.kyc_verifications (user_id, session_id, status, vendor_data)
  VALUES (p_user_id, p_session_id, 'PENDING_REVIEW', jsonb_build_object('initiated_at', NOW()));

  RETURN jsonb_build_object('success', true, 'session_id', p_session_id);
END;
$$;
