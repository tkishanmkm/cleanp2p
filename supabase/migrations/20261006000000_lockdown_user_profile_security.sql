-- ==============================================================================
-- Supabase Migration: 20261006000000_lockdown_user_profile_security.sql
-- Description: PART 1B — Database Security Lockdown for public.profiles
--              1. Schema extension: Ensure all sensitive 2FA, freeze, and lifecycle columns exist.
--              2. Trigger hardening: Update public.prevent_unauthorized_profile_updates()
--                 to strictly block unauthorized self-mutation of all security-sensitive columns:
--                 - User 2FA / TOTP credentials & flags (two_factor_secret, totp_secret, is_2fa_enabled, is_mfa_enabled, two_factor_enabled)
--                 - Admin 2FA credentials & security state (admin_2fa_enabled, admin_2fa_secret, admin_2fa_recovery_hash, admin_2fa_recovery_updated_at)
--                 - Individual emergency freeze state (is_emergency_frozen, emergency_frozen_at, emergency_frozen_by, emergency_freeze_reason)
--                 - Password change security hold timestamp (password_changed_at)
--                 - Administrative authorization & roles (role, is_admin, is_admin_account)
--                 - Account status, bans, suspensions, and limits (is_banned, is_suspended, ban_reason, suspension_reason, is_withdrawal_locked, withdrawals_disabled)
--                 - KYC identity verification & lifecycle fields (kyc_status, is_verified, id_verified, is_kyc_locked, verification_tier, kyc_attempts, kyc_retry_count, kyc_retry_after)
--                 - Verified legal identity fields (full_name, dob, date_of_birth, country) once approved
--              3. Safe User 2FA Status RPC: public.get_user_2fa_status(p_user_id UUID DEFAULT NULL)
--                 Returns boolean only; zero disclosure of raw secrets or hashes.
--              4. Legacy table lockdown: Revoke client access to public.users / public.users_old if present.
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Schema Extension on public.profiles
-- Ensure all audited sensitive security and lifecycle columns exist deterministically
-- ------------------------------------------------------------------------------
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS totp_secret TEXT,
    ADD COLUMN IF NOT EXISTS two_factor_enabled BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_2fa_enabled BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_mfa_enabled BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS two_factor_secret TEXT,
    ADD COLUMN IF NOT EXISTS admin_2fa_enabled BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS admin_2fa_secret TEXT,
    ADD COLUMN IF NOT EXISTS admin_2fa_recovery_hash TEXT,
    ADD COLUMN IF NOT EXISTS admin_2fa_recovery_updated_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS is_emergency_frozen BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS emergency_frozen_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS emergency_frozen_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS emergency_freeze_reason TEXT,
    ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user',
    ADD COLUMN IF NOT EXISTS is_admin BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_admin_account BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_banned BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS ban_reason TEXT,
    ADD COLUMN IF NOT EXISTS suspension_reason TEXT,
    ADD COLUMN IF NOT EXISTS is_withdrawal_locked BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS withdrawals_disabled BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS kyc_status TEXT DEFAULT 'none',
    ADD COLUMN IF NOT EXISTS is_verified BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS id_verified BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS is_kyc_locked BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS verification_tier TEXT DEFAULT 'tier_0',
    ADD COLUMN IF NOT EXISTS kyc_attempts INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS kyc_retry_count INTEGER DEFAULT 0,
    ADD COLUMN IF NOT EXISTS kyc_retry_after TIMESTAMPTZ;

-- ------------------------------------------------------------------------------
-- 2. Hardened Profile Mutation Guard Function & Trigger
-- Blocks unprivileged mutation of all sensitive security, administrative, 2FA, freeze, and KYC fields
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prevent_unauthorized_profile_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_is_trusted_caller BOOLEAN;
BEGIN
    -- Authoritative verification: Allow service_role or verified administrators
    v_is_trusted_caller := (
        auth.role() = 'service_role' OR
        current_setting('role', true) = 'service_role' OR
        public.is_admin()
    );

    IF v_is_trusted_caller THEN
        RETURN NEW;
    END IF;

    -- Normal authenticated users MUST NOT be able to modify any protected security/admin/lifecycle fields:
    IF (
        -- User 2FA / TOTP credentials & flags
        OLD.two_factor_secret IS DISTINCT FROM NEW.two_factor_secret OR
        OLD.totp_secret IS DISTINCT FROM NEW.totp_secret OR
        OLD.is_2fa_enabled IS DISTINCT FROM NEW.is_2fa_enabled OR
        OLD.is_mfa_enabled IS DISTINCT FROM NEW.is_mfa_enabled OR
        OLD.two_factor_enabled IS DISTINCT FROM NEW.two_factor_enabled OR

        -- Admin 2FA credentials & security settings
        OLD.admin_2fa_enabled IS DISTINCT FROM NEW.admin_2fa_enabled OR
        OLD.admin_2fa_secret IS DISTINCT FROM NEW.admin_2fa_secret OR
        OLD.admin_2fa_recovery_hash IS DISTINCT FROM NEW.admin_2fa_recovery_hash OR
        OLD.admin_2fa_recovery_updated_at IS DISTINCT FROM NEW.admin_2fa_recovery_updated_at OR

        -- Emergency freeze state & audit attribution
        OLD.is_emergency_frozen IS DISTINCT FROM NEW.is_emergency_frozen OR
        OLD.emergency_frozen_at IS DISTINCT FROM NEW.emergency_frozen_at OR
        OLD.emergency_frozen_by IS DISTINCT FROM NEW.emergency_frozen_by OR
        OLD.emergency_freeze_reason IS DISTINCT FROM NEW.emergency_freeze_reason OR

        -- Password modification security hold timestamp
        OLD.password_changed_at IS DISTINCT FROM NEW.password_changed_at OR

        -- Administrative authorization & role privileges
        OLD.role IS DISTINCT FROM NEW.role OR
        OLD.is_admin IS DISTINCT FROM NEW.is_admin OR
        OLD.is_admin_account IS DISTINCT FROM NEW.is_admin_account OR

        -- Account status, bans, suspensions, and limits
        OLD.is_banned IS DISTINCT FROM NEW.is_banned OR
        OLD.is_suspended IS DISTINCT FROM NEW.is_suspended OR
        OLD.ban_reason IS DISTINCT FROM NEW.ban_reason OR
        OLD.suspension_reason IS DISTINCT FROM NEW.suspension_reason OR
        OLD.is_withdrawal_locked IS DISTINCT FROM NEW.is_withdrawal_locked OR
        OLD.withdrawals_disabled IS DISTINCT FROM NEW.withdrawals_disabled OR

        -- KYC identity verification & lifecycle fields
        OLD.kyc_status IS DISTINCT FROM NEW.kyc_status OR
        OLD.is_verified IS DISTINCT FROM NEW.is_verified OR
        OLD.id_verified IS DISTINCT FROM NEW.id_verified OR
        OLD.is_kyc_locked IS DISTINCT FROM NEW.is_kyc_locked OR
        OLD.verification_tier IS DISTINCT FROM NEW.verification_tier OR
        OLD.kyc_attempts IS DISTINCT FROM NEW.kyc_attempts OR
        OLD.kyc_retry_count IS DISTINCT FROM NEW.kyc_retry_count OR
        OLD.kyc_retry_after IS DISTINCT FROM NEW.kyc_retry_after
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Modifying protected profile fields (role, 2FA, freeze, KYC, bans, or limits) directly is prohibited by security policy.'
            USING ERRCODE = '42501';
    END IF;

    -- If user is already KYC verified/approved, lock full_name, dob, and country from self-mutation
    IF (
        (OLD.kyc_status IN ('approved', 'verified', 'APPROVED', 'VERIFIED') OR OLD.is_verified = TRUE OR OLD.id_verified = TRUE) AND (
            OLD.full_name IS DISTINCT FROM NEW.full_name OR
            OLD.dob IS DISTINCT FROM NEW.dob OR
            OLD.date_of_birth IS DISTINCT FROM NEW.date_of_birth OR
            (OLD.is_country_locked = TRUE AND OLD.country IS DISTINCT FROM NEW.country)
        )
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Verified legal identity fields (name, date of birth, country) cannot be modified after KYC approval.'
            USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

-- Drop any previous or stale trigger variants
DROP TRIGGER IF EXISTS trg_prevent_kyc_updates ON public.profiles;
DROP TRIGGER IF EXISTS trg_prevent_unauthorized_profile_updates ON public.profiles;

-- Bind the updated trigger before update
CREATE TRIGGER trg_prevent_unauthorized_profile_updates
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_unauthorized_profile_updates();

-- ------------------------------------------------------------------------------
-- 3. Safe User 2FA Status RPC: public.get_user_2fa_status()
-- Exposes ONLY boolean 2FA status for the authenticated user (or target user if admin/service_role).
-- Never returns TOTP secrets, recovery codes, or admin 2FA attributes.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_user_2fa_status(p_user_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_target_id UUID;
    v_is_enabled BOOLEAN := FALSE;
BEGIN
    v_caller_id := auth.uid();

    -- Determine target user: if p_user_id is provided, only allow if caller is service_role or admin or querying own id
    IF p_user_id IS NOT NULL AND (v_caller_id IS NULL OR p_user_id <> v_caller_id) THEN
        IF auth.role() != 'service_role' AND current_setting('role', true) != 'service_role' AND NOT public.is_admin() THEN
            RAISE EXCEPTION 'Unauthorized: cannot query 2FA status of another user'
                USING ERRCODE = '42501';
        END IF;
        v_target_id := p_user_id;
    ELSE
        v_target_id := COALESCE(v_caller_id, p_user_id);
    END IF;

    -- Fail-closed if no user identifier could be determined
    IF v_target_id IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT COALESCE(
        p.is_2fa_enabled,
        p.is_mfa_enabled,
        p.two_factor_enabled,
        (p.two_factor_secret IS NOT NULL AND length(trim(p.two_factor_secret)) > 0),
        FALSE
    )
    INTO v_is_enabled
    FROM public.profiles p
    WHERE p.id = v_target_id;

    RETURN COALESCE(v_is_enabled, FALSE);
END;
$$;

-- Enforce strict privilege boundary on get_user_2fa_status
REVOKE ALL ON FUNCTION public.get_user_2fa_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_2fa_status(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 4. Legacy Table Access Lockdown
-- Ensure no unprivileged user can read or modify legacy user tables if they exist
-- ------------------------------------------------------------------------------
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'users'
    ) THEN
        REVOKE ALL ON TABLE public.users FROM PUBLIC, anon, authenticated;
        GRANT SELECT ON TABLE public.users TO service_role;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'users_old'
    ) THEN
        REVOKE ALL ON TABLE public.users_old FROM PUBLIC, anon, authenticated;
        GRANT SELECT ON TABLE public.users_old TO service_role;
    END IF;
END $$;

COMMIT;
