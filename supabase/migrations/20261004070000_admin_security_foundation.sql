-- Migration: 20261004070000_admin_security_foundation.sql
-- Description: PART 21A Admin Security Foundation - Admin Theme Preference, TOTP 2FA, and Recovery Password Storage

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS admin_theme_preference TEXT DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS admin_2fa_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS admin_2fa_secret TEXT,
  ADD COLUMN IF NOT EXISTS admin_2fa_recovery_hash TEXT,
  ADD COLUMN IF NOT EXISTS admin_2fa_recovery_updated_at TIMESTAMPTZ;

-- Ensure indexes for admin 2FA lookup
CREATE INDEX IF NOT EXISTS idx_profiles_admin_2fa ON public.profiles(id) WHERE (is_admin = TRUE OR role = 'admin');

COMMENT ON COLUMN public.profiles.admin_theme_preference IS 'Admin portal preferred theme: light, dark, or system';
COMMENT ON COLUMN public.profiles.admin_2fa_enabled IS 'Flag indicating if Admin Authenticator TOTP 2FA is active';
COMMENT ON COLUMN public.profiles.admin_2fa_secret IS 'Base32 TOTP secret key for Admin 2FA';
COMMENT ON COLUMN public.profiles.admin_2fa_recovery_hash IS 'SHA-256 hash of the Admin 2FA recovery password';
