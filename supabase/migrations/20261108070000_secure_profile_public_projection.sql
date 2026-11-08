-- Separate public trader-card data from private account profile data.
-- Public clients query public_profiles; authenticated users may read only their
-- own whitelisted profile columns; verified admins retain scoped read access.
BEGIN;

DO $profile_schema_guard$
BEGIN
  IF to_regclass('public.profiles') IS NULL THEN
    RAISE EXCEPTION 'Required public.profiles table is missing; refusing profile lockdown.';
  END IF;

  IF to_regprocedure('public.is_admin()') IS NULL THEN
    RAISE EXCEPTION 'Required identity-bound public.is_admin() helper is missing; refusing profile lockdown.';
  END IF;

  IF NOT (
    SELECT count(*) = 33
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = ANY (ARRAY[
        'id', 'username', 'display_name', 'avatar_url', 'photo_url', 'country',
        'country_code', 'created_at', 'is_online', 'is_verified',
        'completed_trades', 'total_completed_trades', 'trade_volume',
        'total_volume_usd', 'total_traded_usd', 'positive_feedback',
        'negative_feedback', 'feedback_score', 'avg_payment_time_mins',
        'avg_payment_minutes', 'avg_pay_time', 'avg_release_time_mins',
        'avg_release_minutes', 'avg_release_time', 'merchant_tier',
        'status', 'account_status', 'is_banned', 'is_suspended',
        'is_restricted', 'is_on_hold', 'is_emergency_frozen', 'is_minor_restricted'
      ])
  ) THEN
    RAISE EXCEPTION 'Required public profile projection columns are incomplete; refusing profile lockdown.';
  END IF;
END;
$profile_schema_guard$;

-- Remove every SELECT/ALL policy so PostgreSQL's permissive-policy OR
-- semantics cannot preserve an unknown broad read path. The two explicit
-- policies below are the complete base-table SELECT boundary.
DO $drop_profile_read_policies$
DECLARE
  v_policy RECORD;
BEGIN
  FOR v_policy IN
    SELECT policyname
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'profiles'
      AND cmd IN ('SELECT', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY %I ON public.profiles', v_policy.policyname);
  END LOOP;
END;
$drop_profile_read_policies$;

-- Base-table reads are owner-only, with a separate authenticated admin policy.
DROP POLICY IF EXISTS "profiles_select_own" ON public.profiles;
DROP POLICY IF EXISTS "profiles_select_admin" ON public.profiles;
CREATE POLICY "profiles_select_own"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() IS NOT NULL AND auth.uid() = id);

CREATE POLICY "profiles_select_admin"
ON public.profiles
FOR SELECT
TO authenticated
USING ((SELECT public.is_admin()));

-- Remove table-level and column-level SELECT rights from anonymous clients.
-- Remove old authenticated column grants too, then grant the reviewed allowlist
-- below. Existing UPDATE column grants are intentionally preserved.
REVOKE SELECT ON TABLE public.profiles FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.profiles FROM PUBLIC, anon;

DO $revoke_profile_column_reads$
DECLARE
  v_grant RECORD;
BEGIN
  FOR v_grant IN
    SELECT DISTINCT grantee, column_name
    FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND privilege_type = 'SELECT'
      AND grantee IN ('PUBLIC', 'anon', 'authenticated')
  LOOP
    EXECUTE format(
      'REVOKE SELECT (%I) ON TABLE public.profiles FROM %s',
      v_grant.column_name,
      CASE WHEN v_grant.grantee = 'PUBLIC'
        THEN 'PUBLIC'
        ELSE format('%I', v_grant.grantee)
      END
    );
  END LOOP;
END;
$revoke_profile_column_reads$;

-- Only non-secret profile fields are client-readable. RLS means a normal user
-- can see their own row only; public and authenticated admin views are separate.
-- TOTP seeds, recovery hashes, security answers, KYC documents/session IDs,
-- identity-document numbers and deposit addresses are intentionally excluded.
GRANT SELECT (
  id,
  user_id,
  username,
  email,
  full_name,
  display_name,
  name,
  avatar_url,
  photo_url,
  role,
  is_admin,
  is_admin_account,
  status,
  account_status,
  is_banned,
  is_suspended,
  is_restricted,
  is_on_hold,
  is_emergency_frozen,
  is_minor_restricted,
  ban_reason,
  ban_policy,
  banned_at,
  suspension_reason,
  emergency_freeze_reason,
  emergency_frozen_at,
  emergency_frozen_by,
  is_withdrawal_locked,
  withdrawals_disabled,
  is_2fa_enabled,
  is_mfa_enabled,
  two_factor_enabled,
  admin_2fa_enabled,
  admin_2fa_recovery_updated_at,
  is_verified,
  id_verified,
  kyc_status,
  verification_tier,
  is_kyc_locked,
  kyc_attempts,
  kyc_retry_count,
  kyc_retry_after,
  kyc_submitted_at,
  kyc_approved_at,
  kyc_last_attempt_at,
  username_changed,
  username_changed_count,
  username_changes_count,
  username_changes_remaining,
  username_changed_at,
  name_visibility,
  name_privacy,
  preferred_currency,
  preferred_fiat,
  country,
  country_code,
  is_country_locked,
  dob,
  date_of_birth,
  address,
  address_street,
  address_city,
  address_postal_code,
  security_question,
  onboarding_completed,
  terms_accepted_at,
  auth_provider,
  email_verified,
  is_online,
  last_seen,
  last_seen_at,
  created_at,
  updated_at,
  password_changed_at,
  trade_volume,
  total_traded_usd,
  total_volume_usd,
  total_trades,
  total_trades_count,
  completed_trades,
  total_completed_trades,
  positive_feedback,
  negative_feedback,
  feedback_score,
  avg_payment_time_mins,
  avg_payment_minutes,
  avg_pay_time,
  avg_release_time_mins,
  avg_release_minutes,
  avg_release_time,
  merchant_tier,
  merchant_applied_tier,
  merchant_status,
  merchant_deposit_usdt,
  wallet_index,
  public_id,
  user_custom_id
) ON TABLE public.profiles TO authenticated;

-- Keep the self-update policy explicitly bound to the authenticated row.
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;
DROP POLICY IF EXISTS "profiles_update_own" ON public.profiles;
CREATE POLICY "profiles_update_own"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() IS NOT NULL AND auth.uid() = id)
WITH CHECK (auth.uid() IS NOT NULL AND auth.uid() = id);

-- A reviewed public projection; no private identity, account, wallet or 2FA data.
CREATE OR REPLACE VIEW public.public_profiles
WITH (security_barrier = true)
AS
SELECT
  p.id,
  p.username,
  p.display_name,
  p.avatar_url,
  p.photo_url,
  p.country,
  p.country_code,
  p.created_at,
  p.is_online,
  p.is_verified,
  p.completed_trades,
  p.total_completed_trades,
  p.trade_volume,
  p.total_volume_usd,
  p.total_traded_usd,
  p.positive_feedback,
  p.negative_feedback,
  p.feedback_score,
  p.avg_payment_time_mins,
  p.avg_payment_minutes,
  p.avg_pay_time,
  p.avg_release_time_mins,
  p.avg_release_minutes,
  p.avg_release_time,
  p.merchant_tier,
  (
    LOWER(COALESCE(p.status::TEXT, '')) = 'active'
    AND LOWER(COALESCE(p.account_status, 'active')) = 'active'
    AND NOT COALESCE(p.is_banned, FALSE)
    AND NOT COALESCE(p.is_suspended, FALSE)
    AND NOT COALESCE(p.is_restricted, FALSE)
    AND NOT COALESCE(p.is_on_hold, FALSE)
    AND NOT COALESCE(p.is_emergency_frozen, FALSE)
    AND NOT COALESCE(p.is_minor_restricted, FALSE)
  ) AS is_trading_eligible
FROM public.profiles AS p;

ALTER VIEW public.public_profiles OWNER TO postgres;
REVOKE ALL ON TABLE public.public_profiles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.public_profiles TO anon, authenticated, service_role;

COMMIT;
