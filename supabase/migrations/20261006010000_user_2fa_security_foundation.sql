-- ==============================================================================
-- Supabase Migration: 20261006010000_user_2fa_security_foundation.sql
-- Description: PART 2B — User Authenticator / TOTP 2FA Security Foundation
--              1. Create public.user_2fa_recovery_codes (hashed single-use codes)
--              2. Create public.user_2fa_pending_enrollments (server-bound short-lived setup)
--              3. Create public.user_security_audit_logs (audit events for user security actions)
--              4. Close direct RPC 2FA bypass on release_trade_escrow (service_role only)
--              5. Maintain public.get_user_2fa_status canonicalization
-- ==============================================================================

BEGIN;

-- ------------------------------------------------------------------------------
-- 1. Table: public.user_2fa_recovery_codes
-- Stores SHA-256 hashes of single-use recovery codes. Plaintext is never stored.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_2fa_recovery_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    invalidated_at TIMESTAMPTZ DEFAULT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_2fa_recovery_codes_user_id 
    ON public.user_2fa_recovery_codes(user_id);

CREATE INDEX IF NOT EXISTS idx_user_2fa_recovery_codes_code_hash 
    ON public.user_2fa_recovery_codes(code_hash);

ALTER TABLE public.user_2fa_recovery_codes ENABLE ROW LEVEL SECURITY;

-- Strictly server-only. Deny direct client browser access.
REVOKE ALL ON TABLE public.user_2fa_recovery_codes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.user_2fa_recovery_codes TO service_role, postgres;

-- ------------------------------------------------------------------------------
-- 2. Table: public.user_2fa_pending_enrollments
-- Short-lived, user-bound holding table for in-progress TOTP secret enrollment.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_2fa_pending_enrollments (
    user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
    encrypted_secret TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '10 minutes')
);

CREATE INDEX IF NOT EXISTS idx_user_2fa_pending_enrollments_expires 
    ON public.user_2fa_pending_enrollments(expires_at);

ALTER TABLE public.user_2fa_pending_enrollments ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_2fa_pending_enrollments FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.user_2fa_pending_enrollments TO service_role, postgres;

-- ------------------------------------------------------------------------------
-- 3. Table: public.user_security_audit_logs
-- Immutable audit log for user authentication and 2FA lifecycle events.
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.user_security_audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    details JSONB DEFAULT '{}'::jsonb,
    ip_address TEXT DEFAULT NULL,
    user_agent TEXT DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_security_audit_logs_user_id 
    ON public.user_security_audit_logs(user_id);

CREATE INDEX IF NOT EXISTS idx_user_security_audit_logs_action 
    ON public.user_security_audit_logs(action);

CREATE INDEX IF NOT EXISTS idx_user_security_audit_logs_created_at 
    ON public.user_security_audit_logs(created_at);

ALTER TABLE public.user_security_audit_logs ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.user_security_audit_logs FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.user_security_audit_logs TO service_role, postgres;

-- ------------------------------------------------------------------------------
-- 4. Close Direct RPC 2FA Bypass: public.release_trade_escrow
-- Revoke browser client execution so all escrow releases are forced through
-- hardened Next.js API routes where user 2FA is verified server-side.
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.release_trade_escrow(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_trade_escrow(UUID, UUID) TO service_role, postgres;

-- ------------------------------------------------------------------------------
-- 5. Canonical User 2FA Status RPC: public.get_user_2fa_status
-- Re-affirm canonical boolean check without exposing secrets or hashes.
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

    IF p_user_id IS NOT NULL AND (v_caller_id IS NULL OR p_user_id <> v_caller_id) THEN
        IF auth.role() != 'service_role' AND current_setting('role', true) != 'service_role' AND NOT public.is_admin() THEN
            RAISE EXCEPTION 'Unauthorized: cannot query 2FA status of another user'
                USING ERRCODE = '42501';
        END IF;
        v_target_id := p_user_id;
    ELSE
        v_target_id := COALESCE(v_caller_id, p_user_id);
    END IF;

    IF v_target_id IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT COALESCE(
        p.is_2fa_enabled,
        p.is_mfa_enabled,
        p.two_factor_enabled,
        FALSE
    )
    INTO v_is_enabled
    FROM public.profiles p
    WHERE p.id = v_target_id;

    RETURN COALESCE(v_is_enabled, FALSE);
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_2fa_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_2fa_status(UUID) TO authenticated, service_role;

-- ------------------------------------------------------------------------------
-- 6. Atomic Recovery Code Consumption Function: public.consume_user_2fa_recovery_code
-- Atomically identifies, locks, checks, and consumes a single-use recovery code.
-- Guarantees one recovery code = one successful consumption under concurrent execution.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_user_2fa_recovery_code(
    p_user_id UUID,
    p_code_hash TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_code_id UUID;
BEGIN
    IF p_user_id IS NULL OR p_code_hash IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Atomically find and lock an active matching recovery code row
    SELECT id INTO v_code_id
    FROM public.user_2fa_recovery_codes
    WHERE user_id = p_user_id
      AND code_hash = p_code_hash
      AND used_at IS NULL
      AND invalidated_at IS NULL
    FOR UPDATE SKIP LOCKED
    LIMIT 1;

    IF v_code_id IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Atomically mark the locked row as used
    UPDATE public.user_2fa_recovery_codes
    SET used_at = NOW()
    WHERE id = v_code_id
      AND used_at IS NULL;

    IF FOUND THEN
        RETURN TRUE;
    ELSE
        RETURN FALSE;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_user_2fa_recovery_code(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_user_2fa_recovery_code(UUID, TEXT) TO service_role, postgres;

COMMIT;
