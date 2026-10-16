-- Migration: 20261004080000_admin_security_foundation_hardening.sql
-- Description: Step 1 Security Hardening - Column-Level Privilege Revocation for Verified Live Profiles Columns

-- 1. Ensure Step 1 columns exist on public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS admin_theme_preference TEXT DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS admin_2fa_enabled BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS admin_2fa_secret TEXT,
  ADD COLUMN IF NOT EXISTS admin_2fa_recovery_hash TEXT,
  ADD COLUMN IF NOT EXISTS admin_2fa_recovery_updated_at TIMESTAMPTZ;

-- 2. Theme CHECK Constraint
UPDATE public.profiles
  SET admin_theme_preference = 'system'
  WHERE admin_theme_preference IS NULL OR admin_theme_preference NOT IN ('light', 'dark', 'system');

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS chk_profiles_admin_theme_preference;

ALTER TABLE public.profiles
  ADD CONSTRAINT chk_profiles_admin_theme_preference
  CHECK (admin_theme_preference IN ('light', 'dark', 'system'));

-- 3. COLUMN-LEVEL PRIVILEGE HARDENING (Dropped missing columns bio, phone, currency, last_seen)
REVOKE SELECT ON public.profiles FROM PUBLIC, anon, authenticated;

DO $safe_profile_select_grants$
DECLARE
  v_column_list TEXT;
BEGIN
  -- Legacy profiles schemas differ across environments. Grant only columns that
  -- actually exist, preserving the explicit allowlist and avoiding replay failures.
  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position)
    INTO v_column_list
  FROM information_schema.columns AS c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'profiles'
    AND c.column_name = ANY (ARRAY[
      'id',
      'username',
      'display_name',
      'avatar_url',
      'photo_url',
      'country',
      'is_verified',
      'id_verified',
      'kyc_status',
      'is_online',
      'last_seen_at',
      'created_at',
      'avg_payment_time_mins',
      'avg_payment_minutes',
      'avg_pay_time',
      'avg_release_time_mins',
      'avg_release_minutes',
      'avg_release_time',
      'total_completed_trades',
      'completed_trades',
      'trade_volume',
      'positive_feedback',
      'negative_feedback',
      'feedback_score'
    ]);

  IF v_column_list IS NOT NULL THEN
    EXECUTE format(
      'GRANT SELECT (%s) ON public.profiles TO anon, authenticated',
      v_column_list
    );
  END IF;
END
$safe_profile_select_grants$;

-- 4. Safe SECURITY DEFINER status RPC (exposes only safe booleans, never raw secrets/hashes)
CREATE OR REPLACE FUNCTION public.get_admin_security_status(p_admin_id UUID)
RETURNS TABLE (
  admin_id UUID,
  is_2fa_enabled BOOLEAN,
  has_secret BOOLEAN,
  has_recovery_hash BOOLEAN,
  theme_preference TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- Authorization check: ALLOW service_role or verified admin ONLY; DENY normal authenticated users
  IF auth.role() != 'service_role' AND NOT public.is_admin() THEN
    RAISE EXCEPTION 'Unauthorized access to admin security status';
  END IF;

  RETURN QUERY
  SELECT 
    p.id AS admin_id,
    COALESCE(p.admin_2fa_enabled, p.is_2fa_enabled, FALSE) AS is_2fa_enabled,
    (p.admin_2fa_secret IS NOT NULL AND length(p.admin_2fa_secret) > 0) AS has_secret,
    (p.admin_2fa_recovery_hash IS NOT NULL AND length(p.admin_2fa_recovery_hash) > 0) AS has_recovery_hash,
    COALESCE(p.admin_theme_preference, 'system') AS theme_preference
  FROM public.profiles p
  WHERE p.id = p_admin_id;
END;
$$;

-- Grant execution strictly to service_role (Defense-in-Depth)
REVOKE ALL ON FUNCTION public.get_admin_security_status(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_admin_security_status(UUID) TO service_role;
