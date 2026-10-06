-- Migration: 20261003030000_fix_admin_authorization_rpcs.sql
-- Target: Fix public.verify_admin_login and public.check_is_admin RPCs
-- Security Alignment:
-- 1. Treat profiles.is_admin = true OR profiles.role = 'admin' OR superadmin email list as valid admin access.
-- 2. Clean up function signature overloading for check_is_admin.
-- 3. Support both p_user_uuid / user_uuid and p_user_id / user_uuid parameters.

-- -----------------------------------------------------------------------------
-- 1. PUBLIC.VERIFY_ADMIN_LOGIN(UUID, UUID)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.verify_admin_login(UUID);
DROP FUNCTION IF EXISTS public.verify_admin_login(UUID, UUID);

CREATE OR REPLACE FUNCTION public.verify_admin_login(
    p_user_uuid UUID DEFAULT NULL,
    user_uuid UUID DEFAULT NULL
)
RETURNS TABLE (
    is_valid BOOLEAN,
    role TEXT,
    error_msg TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
    v_uid UUID := COALESCE(p_user_uuid, user_uuid, auth.uid());
    v_user_email TEXT;
    v_profile_role TEXT;
    v_is_admin_flag BOOLEAN := FALSE;
    v_app_role TEXT;
    v_app_is_admin BOOLEAN := FALSE;
    v_is_authorized BOOLEAN := FALSE;
BEGIN
    IF v_uid IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, 'User ID is required'::TEXT;
        RETURN;
    END IF;

    -- Fetch user email & app_metadata from auth.users
    SELECT 
        LOWER(COALESCE(email, '')),
        COALESCE(raw_app_meta_data->>'role', ''),
        COALESCE((raw_app_meta_data->>'is_admin')::BOOLEAN, FALSE)
    INTO v_user_email, v_app_role, v_app_is_admin
    FROM auth.users
    WHERE id = v_uid;

    -- Fetch role & is_admin from public.profiles
    SELECT role, is_admin
    INTO v_profile_role, v_is_admin_flag
    FROM public.profiles
    WHERE id = v_uid;

    -- Check all valid admin authorization criteria
    IF (v_is_admin_flag IS TRUE)
       OR (v_profile_role = 'admin')
       OR (v_user_email IN ('km8870960@gmail.com', 'muralikrishna01051996@gmail.com'))
       OR (v_app_role = 'admin')
       OR (v_app_is_admin IS TRUE)
       OR EXISTS (SELECT 1 FROM public.app_admins WHERE app_admins.user_id = v_uid)
    THEN
        v_is_authorized := TRUE;
    END IF;

    IF v_is_authorized THEN
        RETURN QUERY SELECT TRUE, COALESCE(v_profile_role, 'admin'), NULL::TEXT;
    ELSE
        RETURN QUERY SELECT FALSE, COALESCE(v_profile_role, 'user'), 'User does not have admin privileges.'::TEXT;
    END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.verify_admin_login(UUID, UUID) TO PUBLIC, anon, authenticated, service_role, postgres;


-- -----------------------------------------------------------------------------
-- 2. PUBLIC.CHECK_IS_ADMIN(UUID, UUID)
-- -----------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.check_is_admin();
DROP FUNCTION IF EXISTS public.check_is_admin(UUID);
DROP FUNCTION IF EXISTS public.check_is_admin(UUID, UUID);

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
    v_uid UUID := COALESCE(p_user_id, user_uuid, auth.uid());
    v_user_email TEXT;
    v_profile_role TEXT;
    v_is_admin_flag BOOLEAN := FALSE;
    v_app_role TEXT;
    v_app_is_admin BOOLEAN := FALSE;
BEGIN
    IF v_uid IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Fetch user email & app_metadata from auth.users
    SELECT 
        LOWER(COALESCE(email, '')),
        COALESCE(raw_app_meta_data->>'role', ''),
        COALESCE((raw_app_meta_data->>'is_admin')::BOOLEAN, FALSE)
    INTO v_user_email, v_app_role, v_app_is_admin
    FROM auth.users
    WHERE id = v_uid;

    -- Fetch role & is_admin from public.profiles
    SELECT role, is_admin
    INTO v_profile_role, v_is_admin_flag
    FROM public.profiles
    WHERE id = v_uid;

    -- Return TRUE if any condition matches
    IF (v_is_admin_flag IS TRUE)
       OR (v_profile_role = 'admin')
       OR (v_user_email IN ('km8870960@gmail.com', 'muralikrishna01051996@gmail.com'))
       OR (v_app_role = 'admin')
       OR (v_app_is_admin IS TRUE)
       OR EXISTS (SELECT 1 FROM public.app_admins WHERE app_admins.user_id = v_uid)
    THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_is_admin(UUID, UUID) TO PUBLIC, anon, authenticated, service_role, postgres;
