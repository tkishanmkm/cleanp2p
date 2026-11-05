CREATE OR REPLACE FUNCTION public.admin_update_user_role(p_admin_id uuid, p_target_user_id uuid, p_new_role text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
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

    IF v_caller_id IS NOT NULL AND v_caller_id = p_target_user_id THEN
        RAISE EXCEPTION 'Forbidden: Self-modification of administrative role is not permitted.';
    END IF;

    v_norm_role := LOWER(TRIM(p_new_role));
    IF v_norm_role NOT IN ('user', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: must be "user" or "admin".';
    END IF;

    UPDATE public.profiles
    SET role = v_norm_role,
        is_admin = (v_norm_role = 'admin'),
        is_admin_account = (v_norm_role = 'admin'),
        updated_at = NOW()
    WHERE id = p_target_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target user not found.';
    END IF;

    IF v_norm_role = 'admin' THEN
        INSERT INTO public.app_admins (user_id, role, granted_at)
        VALUES (p_target_user_id, 'admin', NOW())
        ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
    ELSE
        DELETE FROM public.app_admins WHERE user_id = p_target_user_id;
    END IF;

    INSERT INTO public.admin_audit_logs (
        admin_id, action, target_type, target_id, target_user_id, details
    ) VALUES (
        v_caller_id,
        'UPDATE_USER_ROLE',
        'USER',
        p_target_user_id::TEXT,
        p_target_user_id,
        jsonb_build_object(
            'new_role', v_norm_role,
            'updated_by', v_caller_id,
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