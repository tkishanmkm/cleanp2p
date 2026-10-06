-- Migration: 20261003040000_fix_admin_authorization_rpcs.sql
-- Description: Correct admin authorization RPCs (public.verify_admin_login & public.check_is_admin)
-- Fixes:
-- 1. Eliminates PGRST203 overload ambiguity by cleanly dropping obsolete overloads and establishing single canonical functions.
-- 2. Eliminates 22P02 enum coercion error by using type-safe role::TEXT conversion.
-- 3. Authorizes valid admins matching profiles.is_admin = true OR profiles.role = 'admin' OR app_metadata OR app_admins.
-- 4. Removes any email-based whitelist or hard-coded email bypasses.
-- 5. Enforces suspension/ban security checks and safe search_path.

-- =============================================================================
-- 1. CLEANUP OBSOLETE OVERLOADS
-- =============================================================================
DROP FUNCTION IF EXISTS public.verify_admin_login();
DROP FUNCTION IF EXISTS public.verify_admin_login(UUID);
DROP FUNCTION IF EXISTS public.verify_admin_login(UUID, UUID);

DROP FUNCTION IF EXISTS public.check_is_admin();
DROP FUNCTION IF EXISTS public.check_is_admin(UUID);
DROP FUNCTION IF EXISTS public.check_is_admin(UUID, UUID);

-- =============================================================================
-- 2. CANONICAL public.verify_admin_login
-- =============================================================================
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
    v_uid UUID := COALESCE(p_user_uuid, user_uuid, auth.uid());
    v_profile_role TEXT;
    v_is_admin_flag BOOLEAN := FALSE;
    v_is_suspended BOOLEAN := FALSE;
    v_is_banned BOOLEAN := FALSE;
    v_app_role TEXT;
    v_app_is_admin BOOLEAN := FALSE;
    v_is_authorized BOOLEAN := FALSE;
BEGIN
    IF v_uid IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, FALSE, 'User ID is required'::TEXT;
        RETURN;
    END IF;

    -- Fetch user app_metadata from auth.users
    SELECT 
        COALESCE(raw_app_meta_data->>'role', ''),
        COALESCE((raw_app_meta_data->>'is_admin')::BOOLEAN, FALSE)
    INTO v_app_role, v_app_is_admin
    FROM auth.users
    WHERE id = v_uid;

    -- Fetch role, is_admin, and suspension/ban flags from public.profiles
    SELECT 
        role::TEXT,
        COALESCE(is_admin, FALSE),
        COALESCE(is_suspended, FALSE) OR COALESCE(is_on_hold, FALSE) OR LOWER(COALESCE(status::TEXT, '')) = 'suspended',
        COALESCE(is_banned, FALSE) OR LOWER(COALESCE(status::TEXT, '')) = 'banned'
    INTO v_profile_role, v_is_admin_flag, v_is_suspended, v_is_banned
    FROM public.profiles
    WHERE id = v_uid;

    -- Check if profile exists
    IF v_profile_role IS NULL AND v_app_role = '' AND NOT v_app_is_admin THEN
        -- Check if in app_admins table
        IF NOT EXISTS (SELECT 1 FROM public.app_admins WHERE app_admins.user_id = v_uid) THEN
            RETURN QUERY SELECT FALSE, NULL::TEXT, FALSE, 'User profile not found.'::TEXT;
            RETURN;
        END IF;
    END IF;

    -- Enforce ban / suspension checks
    IF v_is_banned OR v_is_suspended THEN
        RETURN QUERY SELECT FALSE, COALESCE(v_profile_role, 'user'), TRUE, 'Administrator account is suspended or banned.'::TEXT;
        RETURN;
    END IF;

    -- Canonical Admin Authorization Check
    IF (v_is_admin_flag IS TRUE)
       OR (LOWER(COALESCE(v_profile_role, '')) = 'admin')
       OR (LOWER(v_app_role) = 'admin')
       OR (v_app_is_admin IS TRUE)
       OR EXISTS (SELECT 1 FROM public.app_admins WHERE app_admins.user_id = v_uid)
    THEN
        v_is_authorized := TRUE;
    END IF;

    IF v_is_authorized THEN
        RETURN QUERY SELECT TRUE, COALESCE(v_profile_role, 'admin'), FALSE, NULL::TEXT;
    ELSE
        RETURN QUERY SELECT FALSE, COALESCE(v_profile_role, 'user'), FALSE, 'User does not have admin privileges.'::TEXT;
    END IF;
END;
$$;

-- Restrict privileges: Revoke PUBLIC and anon, grant to authenticated and server roles
REVOKE ALL ON FUNCTION public.verify_admin_login(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_admin_login(UUID, UUID) TO authenticated, service_role, postgres;


-- =============================================================================
-- 3. CANONICAL public.check_is_admin
-- =============================================================================
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
    v_profile_role TEXT;
    v_is_admin_flag BOOLEAN := FALSE;
    v_is_suspended BOOLEAN := FALSE;
    v_is_banned BOOLEAN := FALSE;
    v_app_role TEXT;
    v_app_is_admin BOOLEAN := FALSE;
BEGIN
    IF v_uid IS NULL THEN
        RETURN FALSE;
    END IF;

    -- Fetch user app_metadata from auth.users
    SELECT 
        COALESCE(raw_app_meta_data->>'role', ''),
        COALESCE((raw_app_meta_data->>'is_admin')::BOOLEAN, FALSE)
    INTO v_app_role, v_app_is_admin
    FROM auth.users
    WHERE id = v_uid;

    -- Fetch role, is_admin, and suspension/ban flags from public.profiles
    SELECT 
        role::TEXT,
        COALESCE(is_admin, FALSE),
        COALESCE(is_suspended, FALSE) OR COALESCE(is_on_hold, FALSE) OR LOWER(COALESCE(status::TEXT, '')) = 'suspended',
        COALESCE(is_banned, FALSE) OR LOWER(COALESCE(status::TEXT, '')) = 'banned'
    INTO v_profile_role, v_is_admin_flag, v_is_suspended, v_is_banned
    FROM public.profiles
    WHERE id = v_uid;

    -- Reject suspended/banned accounts
    IF v_is_banned OR v_is_suspended THEN
        RETURN FALSE;
    END IF;

    -- Canonical Admin Authorization Check
    IF (v_is_admin_flag IS TRUE)
       OR (LOWER(COALESCE(v_profile_role, '')) = 'admin')
       OR (LOWER(v_app_role) = 'admin')
       OR (v_app_is_admin IS TRUE)
       OR EXISTS (SELECT 1 FROM public.app_admins WHERE app_admins.user_id = v_uid)
    THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

-- Restrict privileges: Revoke PUBLIC and anon, grant to authenticated and server roles
REVOKE ALL ON FUNCTION public.check_is_admin(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_is_admin(UUID, UUID) TO authenticated, service_role, postgres;
