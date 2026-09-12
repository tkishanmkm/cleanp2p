-- Migration: 20260911000000_didit_kyc_system.sql
-- Description: Adds and hardens all Didit Biometric KYC columns, indexes, and constraints on public.profiles

ALTER TABLE IF EXISTS public.profiles
  ADD COLUMN IF NOT EXISTS didit_session_id TEXT,
  ADD COLUMN IF NOT EXISTS kyc_vendor_session_id TEXT,
  ADD COLUMN IF NOT EXISTS id_document_number TEXT,
  ADD COLUMN IF NOT EXISTS is_kyc_locked BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_country_locked BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS date_of_birth DATE,
  ADD COLUMN IF NOT EXISTS dob DATE,
  ADD COLUMN IF NOT EXISTS full_name TEXT,
  ADD COLUMN IF NOT EXISTS kyc_status TEXT DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS id_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS suspension_reason TEXT;

-- Indexes for duplicate detection queries
CREATE INDEX IF NOT EXISTS idx_profiles_id_document_number 
  ON public.profiles(id_document_number) 
  WHERE id_document_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_kyc_duplicate_guard 
  ON public.profiles(full_name, date_of_birth, kyc_status) 
  WHERE kyc_status = 'approved';

CREATE INDEX IF NOT EXISTS idx_profiles_didit_session 
  ON public.profiles(didit_session_id);
