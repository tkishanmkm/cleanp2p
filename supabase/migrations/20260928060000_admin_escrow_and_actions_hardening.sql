-- Migration: 20260928060000_admin_escrow_and_actions_hardening.sql
-- Description: Hardening admin role updates, self-promotion prevention, and escrow authorization

-- 1. Hardened RPC for administrative user role update
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

    -- Prevent self-role modification (prevent accidental lockout or self-privilege escalation)
    IF (v_caller_id IS NOT NULL AND v_caller_id = p_target_user_id) OR
       (p_admin_id IS NOT NULL AND p_admin_id = p_target_user_id) THEN
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
        INSERT INTO public.app_admins (user_id, role, granted_at)
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

REVOKE ALL ON FUNCTION public.admin_update_user_role(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role(UUID, UUID, TEXT) TO authenticated, service_role, postgres;
