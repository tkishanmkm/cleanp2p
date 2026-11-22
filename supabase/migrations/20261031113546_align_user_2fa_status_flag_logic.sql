-- Keep the 2FA status RPC consistent with the application's canonical flag logic.
-- The app treats any current/legacy enabled flag as enabled; COALESCE incorrectly
-- stopped at the first non-NULL FALSE value and masked later TRUE flags.
BEGIN;

CREATE OR REPLACE FUNCTION public.get_user_2fa_status(
    p_user_id uuid DEFAULT NULL::uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_caller_id uuid;
    v_target_id uuid;
    v_is_enabled boolean := FALSE;
BEGIN
    v_caller_id := auth.uid();

    IF p_user_id IS NOT NULL
       AND (v_caller_id IS NULL OR p_user_id <> v_caller_id) THEN
        IF auth.role() IS DISTINCT FROM 'service_role'
           AND current_setting('role', true) IS DISTINCT FROM 'service_role'
           AND NOT public.is_admin() THEN
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

    SELECT
        COALESCE(p.is_2fa_enabled, FALSE)
        OR COALESCE(p.is_mfa_enabled, FALSE)
        OR COALESCE(p.two_factor_enabled, FALSE)
    INTO v_is_enabled
    FROM public.profiles AS p
    WHERE p.id = v_target_id;

    RETURN COALESCE(v_is_enabled, FALSE);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_user_2fa_status(uuid)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_2fa_status(uuid)
    TO authenticated, service_role, postgres;
ALTER FUNCTION public.get_user_2fa_status(uuid)
    SET search_path = '';

COMMIT;