-- Add an actor-bound, audited, atomic server RPC for global platform controls.
-- The API layer additionally enforces the full admin session and signed 2FA cookie.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_set_platform_controls_authorized(
    p_updates JSONB,
    p_reason TEXT,
    p_actor_id UUID,
    p_actor_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_auth_email TEXT;
    v_supplied_email TEXT := NULLIF(pg_catalog.btrim(p_actor_email), '');
    v_reason TEXT := NULLIF(pg_catalog.btrim(p_reason), '');
    v_profile RECORD;
    v_key TEXT;
    v_value JSONB;
    v_previous_value JSONB;
    v_action TEXT;
    v_updated JSONB := '{}'::jsonb;
    v_now TIMESTAMPTZ := pg_catalog.clock_timestamp();
    v_count INTEGER;
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Trusted server execution is required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_actor_id IS NULL
       OR p_updates IS NULL
       OR pg_catalog.jsonb_typeof(p_updates) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'A verified administrator and a JSON object of settings are required.'
            USING ERRCODE = '22023';
    END IF;

    SELECT pg_catalog.count(*)::INTEGER
      INTO v_count
      FROM pg_catalog.jsonb_each(p_updates);
    IF v_count < 1 OR v_count > 8 THEN
        RAISE EXCEPTION 'Between one and eight platform controls must be supplied.'
            USING ERRCODE = '22023';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM pg_catalog.jsonb_each(p_updates) AS item(key, value)
        WHERE item.key NOT IN (
            'emergency_mode',
            'prevent_new_trades',
            'prevent_withdrawals',
            'prevent_transfers',
            'prevent_new_ads',
            'prevent_user_login',
            'prevent_new_signups',
            'maintenance_mode'
        )
        OR pg_catalog.jsonb_typeof(item.value) IS DISTINCT FROM 'boolean'
    ) THEN
        RAISE EXCEPTION 'Only allowlisted platform controls with boolean values may be changed.'
            USING ERRCODE = '22023';
    END IF;

    IF p_updates ? 'emergency_mode'
       AND (p_updates->'emergency_mode') = 'true'::jsonb
       AND (v_reason IS NULL OR pg_catalog.length(v_reason) < 3) THEN
        RAISE EXCEPTION 'A reason of at least three characters is required to enable emergency mode.'
            USING ERRCODE = '22023';
    END IF;

    IF v_reason IS NOT NULL AND pg_catalog.length(v_reason) > 1000 THEN
        RAISE EXCEPTION 'The platform-control reason must not exceed 1000 characters.'
            USING ERRCODE = '22023';
    END IF;

    IF NOT public.check_is_admin(p_actor_id, NULL) THEN
        RAISE EXCEPTION 'A full, active administrator grant is required.'
            USING ERRCODE = '42501';
    END IF;

    SELECT u.email
      INTO v_auth_email
      FROM auth.users AS u
     WHERE u.id = p_actor_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Administrator Auth account was not found.'
            USING ERRCODE = '42501';
    END IF;

    IF v_auth_email IS NOT NULL
       AND v_supplied_email IS NOT NULL
       AND pg_catalog.lower(v_auth_email) IS DISTINCT FROM pg_catalog.lower(v_supplied_email) THEN
        RAISE EXCEPTION 'Administrator email does not match the canonical Auth email.'
            USING ERRCODE = '42501';
    END IF;

    SELECT
        p.status::text AS status,
        p.account_status::text AS account_status,
        COALESCE(p.is_banned, FALSE) AS is_banned,
        COALESCE(p.is_suspended, FALSE) AS is_suspended,
        COALESCE(p.is_restricted, FALSE) AS is_restricted,
        COALESCE(p.is_on_hold, FALSE) AS is_on_hold,
        COALESCE(p.is_emergency_frozen, FALSE) AS is_emergency_frozen,
        COALESCE(p.is_minor_restricted, FALSE) AS is_minor_restricted
      INTO v_profile
      FROM public.profiles AS p
     WHERE p.id = p_actor_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Administrator profile was not found.'
            USING ERRCODE = '42501';
    END IF;

    IF pg_catalog.lower(COALESCE(v_profile.status, '')) <> 'active'
       OR (
           NULLIF(pg_catalog.btrim(COALESCE(v_profile.account_status, '')), '') IS NOT NULL
           AND pg_catalog.lower(v_profile.account_status) <> 'active'
       )
       OR v_profile.is_banned
       OR v_profile.is_suspended
       OR v_profile.is_restricted
       OR v_profile.is_on_hold
       OR v_profile.is_emergency_frozen
       OR v_profile.is_minor_restricted THEN
        RAISE EXCEPTION 'Administrator account is not active or is restricted.'
            USING ERRCODE = '42501';
    END IF;

    FOR v_key, v_value IN
        SELECT item.key, item.value
          FROM pg_catalog.jsonb_each(p_updates) AS item(key, value)
         ORDER BY item.key
    LOOP
        SELECT s.value
          INTO v_previous_value
          FROM public.system_settings AS s
         WHERE s.key = v_key
         FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Required platform-control row % is missing.', v_key
                USING ERRCODE = '55000';
        END IF;

        UPDATE public.system_settings
           SET value = v_value,
               updated_at = v_now
         WHERE key = v_key;
        IF NOT FOUND THEN
            RAISE EXCEPTION 'Platform-control row % could not be updated.', v_key
                USING ERRCODE = '55000';
        END IF;

        v_action := CASE v_key
            WHEN 'emergency_mode' THEN CASE WHEN v_value = 'true'::jsonb THEN 'EMERGENCY_MODE_ENABLED' ELSE 'EMERGENCY_MODE_DISABLED' END
            WHEN 'maintenance_mode' THEN CASE WHEN v_value = 'true'::jsonb THEN 'MAINTENANCE_MODE_ENABLED' ELSE 'MAINTENANCE_MODE_DISABLED' END
            WHEN 'prevent_new_trades' THEN CASE WHEN v_value = 'true'::jsonb THEN 'GLOBAL_TRADING_DISABLED' ELSE 'GLOBAL_TRADING_ENABLED' END
            WHEN 'prevent_withdrawals' THEN CASE WHEN v_value = 'true'::jsonb THEN 'GLOBAL_WITHDRAWALS_DISABLED' ELSE 'GLOBAL_WITHDRAWALS_ENABLED' END
            WHEN 'prevent_transfers' THEN CASE WHEN v_value = 'true'::jsonb THEN 'GLOBAL_TRANSFERS_DISABLED' ELSE 'GLOBAL_TRANSFERS_ENABLED' END
            WHEN 'prevent_new_ads' THEN CASE WHEN v_value = 'true'::jsonb THEN 'GLOBAL_AD_CREATION_DISABLED' ELSE 'GLOBAL_AD_CREATION_ENABLED' END
            WHEN 'prevent_user_login' THEN CASE WHEN v_value = 'true'::jsonb THEN 'GLOBAL_LOGIN_DISABLED' ELSE 'GLOBAL_LOGIN_ENABLED' END
            WHEN 'prevent_new_signups' THEN CASE WHEN v_value = 'true'::jsonb THEN 'GLOBAL_SIGNUP_DISABLED' ELSE 'GLOBAL_SIGNUP_ENABLED' END
            ELSE NULL
        END;

        INSERT INTO public.admin_audit_logs (
            admin_id, admin_email, action, target_id, details, created_at
        )
        VALUES (
            p_actor_id,
            v_auth_email,
            v_action,
            v_key,
            pg_catalog.jsonb_build_object(
                'setting_key', v_key,
                'previous_value', v_previous_value,
                'new_value', v_value,
                'reason', COALESCE(v_reason, 'Manual administrator update'),
                'updated_at', v_now
            ),
            v_now
        );

        v_updated := v_updated || pg_catalog.jsonb_build_object(v_key, v_value);
    END LOOP;

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'updated', v_updated,
        'updated_at', v_now
    );
END;
$function$;

ALTER FUNCTION public.admin_set_platform_controls_authorized(JSONB, TEXT, UUID, TEXT)
    OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_platform_controls_authorized(JSONB, TEXT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.admin_set_platform_controls_authorized(JSONB, TEXT, UUID, TEXT)
    TO service_role, postgres;

-- Retain the existing four-argument entry point expected by older server code,
-- but delegate to the same actor-verified atomic implementation.
CREATE OR REPLACE FUNCTION public.admin_set_emergency_mode_authorized(
    p_enabled BOOLEAN,
    p_reason TEXT,
    p_actor_id UUID,
    p_actor_email TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    IF p_enabled IS NULL THEN
        RAISE EXCEPTION 'Emergency-mode state is required.'
            USING ERRCODE = '22023';
    END IF;

    RETURN public.admin_set_platform_controls_authorized(
        pg_catalog.jsonb_build_object('emergency_mode', p_enabled),
        p_reason,
        p_actor_id,
        p_actor_email
    );
END;
$function$;

ALTER FUNCTION public.admin_set_emergency_mode_authorized(BOOLEAN, TEXT, UUID, TEXT)
    OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_emergency_mode_authorized(BOOLEAN, TEXT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.admin_set_emergency_mode_authorized(BOOLEAN, TEXT, UUID, TEXT)
    TO service_role, postgres;

COMMENT ON FUNCTION public.admin_set_platform_controls_authorized(JSONB, TEXT, UUID, TEXT) IS
    'Atomically updates allowlisted global platform controls and matching admin audit rows; service-role only and bound to an active administrator actor.';

COMMIT;
