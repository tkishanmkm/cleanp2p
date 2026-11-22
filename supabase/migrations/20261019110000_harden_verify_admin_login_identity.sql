-- Prevent SECURITY DEFINER admin-login RPC from disclosing another user's role.
-- The admin login UI passes the freshly authenticated user's own ID. Enforce that
-- identity in Postgres; only service_role may inspect an explicitly supplied target.
-- Local preparation only: validate in an isolated database before applying.
BEGIN;

CREATE OR REPLACE FUNCTION public.verify_admin_login(
    p_user_uuid uuid DEFAULT NULL,
    user_uuid uuid DEFAULT NULL
)
RETURNS TABLE (
    is_valid boolean,
    role_val text,
    suspended_val boolean,
    error_msg text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_caller_id uuid := auth.uid();
    -- Trust the verified JWT role claim only; do not infer service identity
    -- from mutable session settings.
    v_is_service_role boolean := COALESCE(auth.role() = 'service_role', false);
    v_uid uuid;
    v_profile_role text;
    v_is_admin_flag boolean := false;
    v_is_suspended boolean := false;
    v_is_banned boolean := false;
    v_is_deleted boolean := false;
    v_app_role text;
    v_app_is_admin boolean := false;
    v_is_authorized boolean := false;
BEGIN
    -- Anonymous callers must not use this SECURITY DEFINER function to probe
    -- whether an arbitrary UUID has administrative privileges.
    IF NOT v_is_service_role THEN
        IF v_caller_id IS NULL THEN
            RETURN QUERY SELECT false, NULL::text, false, 'Authentication required.'::text;
            RETURN;
        END IF;

        IF (p_user_uuid IS NOT NULL AND p_user_uuid <> v_caller_id)
           OR (user_uuid IS NOT NULL AND user_uuid <> v_caller_id) THEN
            RETURN QUERY SELECT false, 'user'::text, false, 'Authenticated user identity mismatch.'::text;
            RETURN;
        END IF;

        v_uid := v_caller_id;
    ELSE
        v_uid := COALESCE(p_user_uuid, user_uuid, v_caller_id);
    END IF;

    IF v_uid IS NULL THEN
        RETURN QUERY SELECT false, NULL::text, false, 'User ID is required.'::text;
        RETURN;
    END IF;

    SELECT
        COALESCE(u.raw_app_meta_data->>'role', ''),
        COALESCE((u.raw_app_meta_data->>'is_admin')::boolean, false)
    INTO v_app_role, v_app_is_admin
    FROM auth.users u
    WHERE u.id = v_uid;

    SELECT
        p.role::text,
        COALESCE(p.is_admin, false),
        COALESCE(p.is_suspended, false) OR COALESCE(p.is_on_hold, false)
            OR LOWER(COALESCE(p.status::text, '')) IN ('suspended', 'on_hold', 'hold')
            OR UPPER(COALESCE(p.account_status::text, '')) IN ('SUSPENDED', 'ON_HOLD', 'HOLD'),
        COALESCE(p.is_banned, false)
            OR LOWER(COALESCE(p.status::text, '')) = 'banned'
            OR UPPER(COALESCE(p.account_status::text, '')) = 'BANNED',
        LOWER(COALESCE(p.status::text, '')) = 'deleted'
            OR UPPER(COALESCE(p.account_status::text, '')) IN ('DELETED', 'DELETION_PENDING')
    INTO v_profile_role, v_is_admin_flag, v_is_suspended, v_is_banned, v_is_deleted
    FROM public.profiles p
    WHERE p.id = v_uid;

    IF v_profile_role IS NULL AND v_app_role = '' AND NOT v_app_is_admin
       AND NOT EXISTS (SELECT 1 FROM public.app_admins aa WHERE aa.user_id = v_uid) THEN
        RETURN QUERY SELECT false, NULL::text, false, 'User profile not found.'::text;
        RETURN;
    END IF;

    IF v_is_banned OR v_is_suspended OR v_is_deleted THEN
        RETURN QUERY SELECT false, COALESCE(v_profile_role, 'user'), true,
            CASE
                WHEN v_is_deleted THEN 'Account is deleted or pending deletion.'::text
                ELSE 'Administrator account is suspended or banned.'::text
            END;
        RETURN;
    END IF;

    v_is_authorized :=
        v_is_admin_flag
        OR LOWER(COALESCE(v_profile_role, '')) = 'admin'
        OR LOWER(v_app_role) = 'admin'
        OR v_app_is_admin
        OR EXISTS (SELECT 1 FROM public.app_admins aa WHERE aa.user_id = v_uid);

    IF v_is_authorized THEN
        RETURN QUERY SELECT true, COALESCE(v_profile_role, 'admin'), false, NULL::text;
    ELSE
        RETURN QUERY SELECT false, COALESCE(v_profile_role, 'user'), false,
            'User does not have admin privileges.'::text;
    END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.verify_admin_login(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_admin_login(uuid, uuid) TO authenticated, service_role, postgres;

COMMIT;
