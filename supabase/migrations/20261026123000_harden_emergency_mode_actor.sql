-- Keep emergency-mode mutation behind the server's complete admin/2FA gate.
-- The older two-argument RPC accepted authenticated JWTs and only checked admin
-- role flags, so a client could bypass verifyServerAdmin's signed 2FA cookie.
BEGIN;

REVOKE ALL ON FUNCTION public.admin_set_emergency_mode(BOOLEAN, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;

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
AS $$
DECLARE
    v_actor_email TEXT;
    v_supplied_email TEXT := NULLIF(BTRIM(p_actor_email), '');
    v_clean_reason TEXT := NULLIF(BTRIM(p_reason), '');
    v_prev_val JSONB := NULL;
BEGIN
    -- Only the trusted server client may call this entry point. The Next.js
    -- handler has already verified the auth user, admin grants and 2FA cookie.
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized: trusted server execution required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_actor_id IS NULL THEN
        RAISE EXCEPTION 'An authenticated administrator actor ID is required.'
            USING ERRCODE = '22023';
    END IF;

    SELECT NULLIF(BTRIM(p.email), '')
      INTO v_actor_email
      FROM public.profiles AS p
     WHERE p.id = p_actor_id;

    IF v_actor_email IS NOT NULL
       AND v_supplied_email IS NOT NULL
       AND LOWER(v_actor_email) <> LOWER(v_supplied_email) THEN
        RAISE EXCEPTION 'Administrator email does not match the canonical profile email.'
            USING ERRCODE = '42501';
    END IF;

    v_actor_email := COALESCE(v_actor_email, v_supplied_email);

    IF p_enabled IS TRUE AND (v_clean_reason IS NULL OR LENGTH(v_clean_reason) < 3) THEN
        RAISE EXCEPTION 'Reason required: provide at least three characters when enabling emergency mode.'
            USING ERRCODE = '22023';
    END IF;

    SELECT value
      INTO v_prev_val
      FROM public.system_settings
     WHERE key = 'emergency_mode'
     FOR UPDATE;

    INSERT INTO public.system_settings (key, value, updated_at)
    VALUES ('emergency_mode', TO_JSONB(p_enabled), NOW())
    ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value,
           updated_at = NOW();

    INSERT INTO public.admin_audit_logs (
        admin_id, admin_email, action, target_id, details, created_at
    ) VALUES (
        p_actor_id,
        v_actor_email,
        CASE WHEN p_enabled THEN 'EMERGENCY_MODE_ENABLED' ELSE 'EMERGENCY_MODE_DISABLED' END,
        'emergency_mode',
        JSONB_BUILD_OBJECT(
            'setting_key', 'emergency_mode',
            'previous_value', v_prev_val,
            'new_value', p_enabled,
            'reason', COALESCE(v_clean_reason, 'Manual administrator update'),
            'updated_at', NOW()
        ),
        NOW()
    );

    RETURN JSONB_BUILD_OBJECT(
        'success', TRUE,
        'emergency_mode', p_enabled,
        'updated_at', NOW()
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_emergency_mode_authorized(BOOLEAN, TEXT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_set_emergency_mode_authorized(BOOLEAN, TEXT, UUID, TEXT)
    TO service_role, postgres;

COMMIT;
