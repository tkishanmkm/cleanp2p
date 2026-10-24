-- Harden administrator RPC identity checks.
-- This migration is intentionally staged for review; do not apply to production
-- until the SQL regression suite and staging authorization tests pass.

BEGIN;

CREATE OR REPLACE FUNCTION public.verify_admin_login(
    p_user_uuid uuid DEFAULT NULL,
    user_uuid uuid DEFAULT NULL
)
RETURNS TABLE(is_valid boolean, role_val text, suspended_val boolean, error_msg text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
    v_auth_uid uuid := auth.uid();
    v_uid uuid;
    v_profile_role text;
    v_is_admin_flag boolean := false;
    v_is_suspended boolean := false;
    v_is_banned boolean := false;
    v_app_role text := '';
    v_app_is_admin boolean := false;
    v_is_authorized boolean := false;
BEGIN
    -- A signed-in user may only query their own admin status. Only the
    -- service role may check an explicitly supplied different user's UUID.
    IF v_auth_uid IS NOT NULL THEN
        v_uid := COALESCE(p_user_uuid, user_uuid, v_auth_uid);
        IF v_uid <> v_auth_uid THEN
            RETURN QUERY SELECT FALSE, NULL::text, FALSE, 'User identity mismatch.'::text;
            RETURN;
        END IF;
    ELSE
        IF auth.role() IS DISTINCT FROM 'service_role'
           AND current_setting('role', true) IS DISTINCT FROM 'service_role' THEN
            RETURN QUERY SELECT FALSE, NULL::text, FALSE, 'Authenticated session required.'::text;
            RETURN;
        END IF;
        v_uid := COALESCE(p_user_uuid, user_uuid);
    END IF;

    IF v_uid IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::text, FALSE, 'User ID is required.'::text;
        RETURN;
    END IF;

    SELECT
        COALESCE(u.raw_app_meta_data->>'role', ''),
        COALESCE((u.raw_app_meta_data->>'is_admin')::boolean, FALSE)
    INTO v_app_role, v_app_is_admin
    FROM auth.users AS u
    WHERE u.id = v_uid;

    SELECT
        p.role::text,
        COALESCE(p.is_admin, FALSE),
        COALESCE(p.is_suspended, FALSE)
          OR COALESCE(p.is_on_hold, FALSE)
          OR LOWER(COALESCE(p.status::text, '')) = 'suspended',
        COALESCE(p.is_banned, FALSE)
          OR LOWER(COALESCE(p.status::text, '')) = 'banned'
    INTO v_profile_role, v_is_admin_flag, v_is_suspended, v_is_banned
    FROM public.profiles AS p
    WHERE p.id = v_uid;

    IF v_is_banned OR v_is_suspended THEN
        RETURN QUERY SELECT FALSE, COALESCE(v_profile_role, 'user'), TRUE,
            'Administrator account is suspended or banned.'::text;
        RETURN;
    END IF;

    v_is_authorized :=
        COALESCE(v_is_admin_flag, FALSE)
        OR LOWER(COALESCE(v_profile_role, '')) = 'admin'
        OR LOWER(COALESCE(v_app_role, '')) = 'admin'
        OR COALESCE(v_app_is_admin, FALSE)
        OR EXISTS (
            SELECT 1 FROM public.app_admins AS aa WHERE aa.user_id = v_uid
        );

    IF v_is_authorized THEN
        RETURN QUERY SELECT TRUE, COALESCE(v_profile_role, 'admin'), FALSE, NULL::text;
    ELSE
        RETURN QUERY SELECT FALSE, COALESCE(v_profile_role, 'user'), FALSE,
            'User does not have admin privileges.'::text;
    END IF;
END;
$function$;

-- raw_user_meta_data is user-editable and must never confer administrator
-- privileges. Remove that authorization clause from the two trade RPCs while
-- preserving app_metadata, profiles, and app_admins checks.
DO $migration$
DECLARE
    v_signature regprocedure;
    v_definition text;
    v_patched text;
BEGIN
    FOREACH v_signature IN ARRAY ARRAY[
        to_regprocedure('public.mark_p2p_trade_paid(uuid,uuid,text)'),
        to_regprocedure('public.raise_trade_dispute(uuid,uuid,text)')
    ]
    LOOP
        IF v_signature IS NULL THEN
            RAISE EXCEPTION 'Required trade authorization function is missing.';
        END IF;

        v_definition := pg_get_functiondef(v_signature);
        IF position('raw_user_meta_data' IN v_definition) = 0 THEN
            RAISE EXCEPTION 'Expected user-editable metadata authorization clause not found in %.', v_signature;
        END IF;

        v_patched := regexp_replace(
            v_definition,
            E'raw_user_meta_data\\s*->>\\s*''role''\\s*=\\s*''admin''\\s*OR\\s*',
            '',
            'g'
        );

        IF v_patched = v_definition OR position('raw_user_meta_data' IN v_patched) > 0 THEN
            RAISE EXCEPTION 'Could not safely remove user-editable admin metadata clause from %.', v_signature;
        END IF;

        EXECUTE v_patched;
    END LOOP;
END;
$migration$;

-- These RPCs expose only the caller's own admin status to authenticated users;
-- do not permit anonymous role probing.
REVOKE EXECUTE ON FUNCTION public.verify_admin_login(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_admin_login(uuid, uuid) TO authenticated, service_role;

COMMIT;
