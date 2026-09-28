-- Migration: 20260928050000_kyc_and_admin_security_hardening.sql
-- Description: Full KYC, Admin, Identity & Authorization Security Hardening
-- 1. Prevent non-admin/client direct modification of sensitive profile fields (role, kyc_status, bans, limits)
-- 2. Harden app_admins RLS and prevent unauthorized privilege escalation
-- 3. Authoritative role updating and KYC administrative transitions
-- 4. Audit logging hardening

-- Ensure admin_audit_logs has all auxiliary columns
ALTER TABLE public.admin_audit_logs ADD COLUMN IF NOT EXISTS admin_email TEXT;
ALTER TABLE public.admin_audit_logs ADD COLUMN IF NOT EXISTS target_user_id UUID;

-- 1. Trigger Function to protect sensitive profile columns from unauthorized modification
CREATE OR REPLACE FUNCTION public.prevent_unauthorized_profile_updates()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_is_service_role BOOLEAN;
    v_is_admin BOOLEAN;
BEGIN
    v_is_service_role := (auth.role() = 'service_role');
    v_is_admin := public.is_admin();

    -- Service role and verified admins can update any profile columns
    IF v_is_service_role OR v_is_admin THEN
        RETURN NEW;
    END IF;

    -- Normal authenticated users MUST NOT be able to modify these protected fields:
    IF (
        OLD.role IS DISTINCT FROM NEW.role OR
        OLD.is_admin IS DISTINCT FROM NEW.is_admin OR
        OLD.is_admin_account IS DISTINCT FROM NEW.is_admin_account OR
        OLD.kyc_status IS DISTINCT FROM NEW.kyc_status OR
        OLD.is_verified IS DISTINCT FROM NEW.is_verified OR
        OLD.id_verified IS DISTINCT FROM NEW.id_verified OR
        OLD.verification_tier IS DISTINCT FROM NEW.verification_tier OR
        OLD.is_banned IS DISTINCT FROM NEW.is_banned OR
        OLD.is_suspended IS DISTINCT FROM NEW.is_suspended OR
        OLD.ban_reason IS DISTINCT FROM NEW.ban_reason OR
        OLD.suspension_reason IS DISTINCT FROM NEW.suspension_reason OR
        OLD.is_withdrawal_locked IS DISTINCT FROM NEW.is_withdrawal_locked OR
        OLD.withdrawals_disabled IS DISTINCT FROM NEW.withdrawals_disabled OR
        OLD.kyc_attempts IS DISTINCT FROM NEW.kyc_attempts OR
        OLD.kyc_retry_count IS DISTINCT FROM NEW.kyc_retry_count OR
        OLD.kyc_retry_after IS DISTINCT FROM NEW.kyc_retry_after
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Modifying protected profile fields (role, KYC, ban/suspension, or limits) directly is prohibited by security policy.';
    END IF;

    -- If user is already KYC verified/approved, lock full_name, dob, and country from self-mutation
    IF (
        (OLD.kyc_status = 'approved' OR OLD.kyc_status = 'VERIFIED' OR OLD.is_verified = TRUE OR OLD.id_verified = TRUE) AND (
            OLD.full_name IS DISTINCT FROM NEW.full_name OR
            OLD.dob IS DISTINCT FROM NEW.dob OR
            OLD.date_of_birth IS DISTINCT FROM NEW.date_of_birth OR
            (OLD.is_country_locked = TRUE AND OLD.country IS DISTINCT FROM NEW.country)
        )
    ) THEN
        RAISE EXCEPTION 'Unauthorized: Verified legal identity fields (name, date of birth, country) cannot be modified after KYC approval.';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_unauthorized_profile_updates ON public.profiles;

CREATE TRIGGER trg_prevent_unauthorized_profile_updates
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_unauthorized_profile_updates();

-- 2. Harden app_admins RLS policies
ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_admins_select_policy" ON public.app_admins;
DROP POLICY IF EXISTS "app_admins_insert_policy" ON public.app_admins;
DROP POLICY IF EXISTS "app_admins_update_policy" ON public.app_admins;
DROP POLICY IF EXISTS "app_admins_delete_policy" ON public.app_admins;

-- Only admins or service_role can select from app_admins
CREATE POLICY "app_admins_select_policy" ON public.app_admins
    FOR SELECT USING (
        auth.role() = 'service_role' OR public.is_admin()
    );

-- Only service_role can directly insert, update, or delete app_admins
CREATE POLICY "app_admins_service_role_insert" ON public.app_admins
    FOR INSERT WITH CHECK (
        auth.role() = 'service_role'
    );

CREATE POLICY "app_admins_service_role_update" ON public.app_admins
    FOR UPDATE USING (
        auth.role() = 'service_role'
    ) WITH CHECK (
        auth.role() = 'service_role'
    );

CREATE POLICY "app_admins_service_role_delete" ON public.app_admins
    FOR DELETE USING (
        auth.role() = 'service_role'
    );

-- 3. Hardened RPC for administrative user role update
CREATE OR REPLACE FUNCTION public.admin_update_user_role(
    p_admin_id UUID,
    p_target_user_id UUID,
    p_new_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_caller_id UUID;
    v_is_authorized BOOLEAN;
    v_norm_role TEXT;
BEGIN
    v_caller_id := auth.uid();
    v_is_authorized := (
        auth.role() = 'service_role' OR
        (v_caller_id IS NOT NULL AND public.is_admin())
    );

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Unauthorized: Caller is not a verified administrator.';
    END IF;

    -- Prevent self-role modification (prevent accidental lockout or privilege escalation)
    IF v_caller_id IS NOT NULL AND v_caller_id = p_target_user_id THEN
        RAISE EXCEPTION 'Forbidden: Self-modification of administrative role is not permitted.';
    END IF;

    v_norm_role := LOWER(TRIM(p_new_role));
    IF v_norm_role NOT IN ('user', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: must be "user" or "admin".';
    END IF;

    -- Update profiles table
    UPDATE public.profiles
    SET role = v_norm_role,
        is_admin = (v_norm_role = 'admin'),
        is_admin_account = (v_norm_role = 'admin'),
        updated_at = NOW()
    WHERE id = p_target_user_id;

    -- Update app_admins table
    IF v_norm_role = 'admin' THEN
        INSERT INTO public.app_admins (user_id, role, created_at)
        VALUES (p_target_user_id, 'admin', NOW())
        ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
    ELSE
        DELETE FROM public.app_admins WHERE user_id = p_target_user_id;
    END IF;

    -- Audit log
    INSERT INTO public.admin_audit_logs (
        admin_id,
        action,
        target_type,
        target_id,
        target_user_id,
        details
    ) VALUES (
        COALESCE(p_admin_id, v_caller_id),
        'UPDATE_USER_ROLE',
        'USER',
        p_target_user_id::TEXT,
        p_target_user_id,
        jsonb_build_object(
            'new_role', v_norm_role,
            'updated_by', COALESCE(p_admin_id, v_caller_id),
            'timestamp', NOW()
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'target_user_id', p_target_user_id,
        'role', v_norm_role
    );
END;
$$;
