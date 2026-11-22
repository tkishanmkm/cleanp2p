-- Forward-only hardening: bind admin role-update audit identity to the verified caller.
-- Validate against a disposable, schema-matched database before deployment.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_update_user_role(
    p_admin_id UUID,
    p_target_user_id UUID,
    p_new_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $function$
DECLARE
    v_caller_id UUID := auth.uid();
    v_is_service_role BOOLEAN := COALESCE(auth.role() = 'service_role', false);
    v_is_authorized BOOLEAN := false;
    v_norm_role TEXT;
    v_audit_actor UUID;
BEGIN
    IF NOT v_is_service_role THEN
        IF v_caller_id IS NULL THEN
            RAISE EXCEPTION 'Authentication required.';
        END IF;

        -- A client cannot select a different administrator identity for the audit trail.
        IF p_admin_id IS NOT NULL AND p_admin_id <> v_caller_id THEN
            RAISE EXCEPTION 'Authenticated administrator identity mismatch.';
        END IF;
    END IF;

    v_is_authorized := v_is_service_role
        OR (v_caller_id IS NOT NULL AND public.is_admin());

    IF NOT v_is_authorized THEN
        RAISE EXCEPTION 'Unauthorized: Caller is not a verified administrator.';
    END IF;

    IF v_caller_id IS NOT NULL AND v_caller_id = p_target_user_id THEN
        RAISE EXCEPTION 'Forbidden: Self-modification of administrative role is not permitted.';
    END IF;

    v_norm_role := LOWER(TRIM(p_new_role));
    IF v_norm_role IS NULL OR v_norm_role NOT IN ('user', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: must be "user" or "admin".';
    END IF;

    UPDATE public.profiles
    SET role = v_norm_role,
        is_admin = (v_norm_role = 'admin'),
        is_admin_account = (v_norm_role = 'admin'),
        updated_at = NOW()
    WHERE id = p_target_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target user profile not found.';
    END IF;

    IF v_norm_role = 'admin' THEN
        INSERT INTO public.app_admins (user_id, role, created_at)
        VALUES (p_target_user_id, 'admin', NOW())
        ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
    ELSE
        DELETE FROM public.app_admins WHERE user_id = p_target_user_id;
    END IF;

    -- Service-role jobs may supply a trusted actor; user JWT calls always use auth.uid().
    v_audit_actor := CASE WHEN v_is_service_role THEN p_admin_id ELSE v_caller_id END;

    INSERT INTO public.admin_audit_logs (
        admin_id, action, target_type, target_id, target_user_id, details
    ) VALUES (
        v_audit_actor,
        'UPDATE_USER_ROLE',
        'USER',
        p_target_user_id::TEXT,
        p_target_user_id,
        jsonb_build_object(
            'new_role', v_norm_role,
            'updated_by', v_audit_actor,
            'timestamp', NOW()
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'target_user_id', p_target_user_id,
        'role', v_norm_role
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_update_user_role(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role(uuid, uuid, text) TO service_role, postgres;


COMMIT;
