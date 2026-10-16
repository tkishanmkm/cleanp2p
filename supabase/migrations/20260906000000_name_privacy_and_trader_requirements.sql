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

-- 2. Legacy p2p_ads compatibility.
-- The canonical ad relation in this repository is public.ads; p2p_ads is not
-- created by the base migration history. Guard the legacy alteration so clean
-- migration replay succeeds while retaining support for older installations.
DO $migration$
BEGIN
    IF to_regclass('public.p2p_ads') IS NOT NULL THEN
        ALTER TABLE public.p2p_ads
            ADD COLUMN IF NOT EXISTS require_full_name_verified BOOLEAN NOT NULL DEFAULT FALSE,
            ADD COLUMN IF NOT EXISTS require_verified_users BOOLEAN NOT NULL DEFAULT FALSE;

        CREATE INDEX IF NOT EXISTS idx_p2p_ads_require_full_name_verified
            ON public.p2p_ads(require_full_name_verified)
            WHERE require_full_name_verified = TRUE;

        CREATE INDEX IF NOT EXISTS idx_p2p_ads_require_verified_users
            ON public.p2p_ads(require_verified_users)
            WHERE require_verified_users = TRUE;

        COMMENT ON COLUMN public.p2p_ads.require_full_name_verified IS
            'Condition: Only full-name verified traders can open a trade on this ad';
        COMMENT ON COLUMN public.p2p_ads.require_verified_users IS
            'Condition: Only identity-verified traders can open a trade on this ad';
    END IF;
END
$migration$;

-- 3. Schema comment for the profile privacy field.
COMMENT ON COLUMN public.profiles.name_visibility IS
    'Controls name display in trade chat: FULL (legal full name), PARTIAL (initial + last name), or HIDE (username only)';
