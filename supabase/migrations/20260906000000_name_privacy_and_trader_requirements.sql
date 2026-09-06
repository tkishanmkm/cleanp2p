-- Migration: 20260906000000_name_privacy_and_trader_requirements.sql
-- Description: Adds name_visibility privacy controls to profiles, and trader verification requirement options to p2p_ads

-- 1. Profiles Table Updates for Name Privacy & 2FA
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS name_visibility TEXT NOT NULL DEFAULT 'FULL'
CHECK (name_visibility IN ('FULL', 'PARTIAL', 'HIDE'));

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS full_name TEXT,
ADD COLUMN IF NOT EXISTS dob DATE,
ADD COLUMN IF NOT EXISTS is_2fa_enabled BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS two_factor_secret TEXT;

-- 2. Ads Table Updates for Verification Requirements
ALTER TABLE public.p2p_ads
ADD COLUMN IF NOT EXISTS require_full_name_verified BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS require_verified_users BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. Indexes for Performance
CREATE INDEX IF NOT EXISTS idx_p2p_ads_require_full_name_verified 
ON public.p2p_ads(require_full_name_verified) 
WHERE require_full_name_verified = TRUE;

CREATE INDEX IF NOT EXISTS idx_p2p_ads_require_verified_users 
ON public.p2p_ads(require_verified_users) 
WHERE require_verified_users = TRUE;

-- 4. Schema Comments
COMMENT ON COLUMN public.profiles.name_visibility IS 'Controls name display in trade chat (i) info modal: FULL (legal full name), PARTIAL (initial + last name e.g. a. dam), or HIDE (hidden, username only)';
COMMENT ON COLUMN public.p2p_ads.require_full_name_verified IS 'Condition: Only full-name verified traders can open a trade on this ad';
COMMENT ON COLUMN public.p2p_ads.require_verified_users IS 'Condition: Only identity-verified traders can open a trade on this ad';
