-- Bind exposed SECURITY DEFINER admin-check RPCs to the authenticated caller.
-- Trusted service-role callers may still check an explicitly supplied user.

CREATE OR REPLACE FUNCTION public.verify_admin_login(
    p_user_uuid UUID DEFAULT NULL,
    user_uuid UUID DEFAULT NULL
)
RETURNS TABLE (
    is_valid BOOLEAN,
    role_val TEXT,
    suspended_val BOOLEAN,
    error_msg TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_uid UUID;
    v_profile_role TEXT;
    v_is_admin_flag BOOLEAN := FALSE;
    v_is_suspended BOOLEAN := FALSE;
    v_is_banned BOOLEAN := FALSE;
    v_app_role TEXT;
    v_app_is_admin BOOLEAN := FALSE;
    v_is_authorized BOOLEAN := FALSE;
BEGIN
    IF auth.role() = 'service_role' OR current_setting('role', true) = 'service_role' THEN
        v_uid := COALESCE(p_user_uuid, user_uuid);
    ELSE
        IF v_auth_uid IS NULL
           OR (p_user_uuid IS NOT NULL AND p_user_uuid <> v_auth_uid)
           OR (user_uuid IS NOT NULL AND user_uuid <> v_auth_uid) THEN
            RETURN QUERY SELECT FALSE, NULL::TEXT, FALSE, 'User identity mismatch'::TEXT;
            RETURN;
        END IF;
        v_uid := v_auth_uid;
    END IF;

    IF v_uid IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, FALSE, 'User ID is required'::TEXT;
        RETURN;
    END IF;

    SELECT
        COALESCE(raw_app_meta_data->>'role', ''),
        COALESCE((raw_app_meta_data->>'is_admin')::BOOLEAN, FALSE)
    INTO v_app_role, v_app_is_admin
    FROM auth.users
    WHERE id = v_uid;

    SELECT
        role::TEXT,
        COALESCE(is_admin, FALSE),
        COALESCE(is_suspended, FALSE) OR COALESCE(is_on_hold, FALSE)
            OR LOWER(COALESCE(status::TEXT, '')) = 'suspended',
        COALESCE(is_banned, FALSE) OR LOWER(COALESCE(status::TEXT, '')) = 'banned'
    INTO v_profile_role, v_is_admin_flag, v_is_suspended, v_is_banned
    FROM public.profiles
    WHERE id = v_uid;

    IF v_profile_role IS NULL AND v_app_role = '' AND NOT v_app_is_admin
       AND NOT EXISTS (SELECT 1 FROM public.app_admins WHERE app_admins.user_id = v_uid) THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, FALSE, 'User profile not found.'::TEXT;
        RETURN;
    END IF;

    IF v_is_banned OR v_is_suspended THEN
        RETURN QUERY SELECT FALSE, COALESCE(v_profile_role, 'user'), TRUE,
            'Administrator account is suspended or banned.'::TEXT;
        RETURN;
    END IF;

    v_is_authorized := (v_is_admin_flag IS TRUE)
        OR LOWER(COALESCE(v_profile_role, '')) = 'admin'
        OR LOWER(COALESCE(v_app_role, '')) = 'admin'
        OR v_app_is_admin IS TRUE
        OR EXISTS (SELECT 1 FROM public.app_admins WHERE app_admins.user_id = v_uid);

    IF v_is_authorized THEN
        RETURN QUERY SELECT TRUE, COALESCE(v_profile_role, 'admin'), FALSE, NULL::TEXT;
    ELSE
        RETURN QUERY SELECT FALSE, COALESCE(v_profile_role, 'user'), FALSE,
            'User does not have admin privileges.'::TEXT;
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_is_admin(
    p_user_id UUID DEFAULT NULL,
    user_uuid UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_uid UUID;
    v_profile_role TEXT;
    v_is_admin_flag BOOLEAN := FALSE;
    v_is_suspended BOOLEAN := FALSE;
    v_is_banned BOOLEAN := FALSE;
    v_app_role TEXT;
    v_app_is_admin BOOLEAN := FALSE;
BEGIN
    IF auth.role() = 'service_role' OR current_setting('role', true) = 'service_role' THEN
        v_uid := COALESCE(p_user_id, user_uuid);
    ELSE
        IF v_auth_uid IS NULL
           OR (p_user_id IS NOT NULL AND p_user_id <> v_auth_uid)
           OR (user_uuid IS NOT NULL AND user_uuid <> v_auth_uid) THEN
            RETURN FALSE;
        END IF;
        v_uid := v_auth_uid;
    END IF;

    IF v_uid IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT
        COALESCE(raw_app_meta_data->>'role', ''),
        COALESCE((raw_app_meta_data->>'is_admin')::BOOLEAN, FALSE)
    INTO v_app_role, v_app_is_admin
    FROM auth.users
    WHERE id = v_uid;

    SELECT
        role::TEXT,
        COALESCE(is_admin, FALSE),
        COALESCE(is_suspended, FALSE) OR COALESCE(is_on_hold, FALSE)
            OR LOWER(COALESCE(status::TEXT, '')) = 'suspended',
        COALESCE(is_banned, FALSE) OR LOWER(COALESCE(status::TEXT, '')) = 'banned'
    INTO v_profile_role, v_is_admin_flag, v_is_suspended, v_is_banned
    FROM public.profiles
    WHERE id = v_uid;

    IF v_is_banned OR v_is_suspended THEN
        RETURN FALSE;
    END IF;

    RETURN (v_is_admin_flag IS TRUE)
        OR LOWER(COALESCE(v_profile_role, '')) = 'admin'
        OR LOWER(COALESCE(v_app_role, '')) = 'admin'
        OR v_app_is_admin IS TRUE
        OR EXISTS (SELECT 1 FROM public.app_admins WHERE app_admins.user_id = v_uid);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_admin_login(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_admin_login(UUID, UUID) TO authenticated, service_role, postgres;
REVOKE ALL ON FUNCTION public.check_is_admin(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_is_admin(UUID, UUID) TO authenticated, service_role, postgres;
