-- Move high-impact freeze/unfreeze behind the server's complete admin/2FA gate.
-- Direct authenticated execution of the old RPCs bypassed verifyServerAdmin's
-- signed 2FA session cookie even though the function bodies checked admin flags.
BEGIN;

REVOKE ALL ON FUNCTION public.admin_freeze_user(UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.admin_unfreeze_user(UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_freeze_user_authorized(
    p_target_user_id UUID,
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
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized: trusted server execution required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_actor_id IS NULL THEN
        RAISE EXCEPTION 'An authenticated administrator actor ID is required.'
            USING ERRCODE = '22023';
    END IF;

    IF p_target_user_id IS NULL OR p_target_user_id = p_actor_id THEN
        RAISE EXCEPTION 'Invalid target: administrators cannot freeze their own account.'
            USING ERRCODE = '42501';
    END IF;

    IF v_clean_reason IS NULL OR LENGTH(v_clean_reason) < 3 THEN
        RAISE EXCEPTION 'Reason required: provide at least three characters.'
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

    UPDATE public.profiles
       SET is_emergency_frozen = TRUE,
           emergency_frozen_at = NOW(),
           emergency_frozen_by = p_actor_id,
           emergency_freeze_reason = v_clean_reason,
           updated_at = NOW()
     WHERE id = p_target_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target user not found.'
            USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.admin_audit_logs (
        admin_id, admin_email, action, target_id, target_user_id, details, created_at
    ) VALUES (
        p_actor_id, v_actor_email, 'USER_EMERGENCY_FREEZE',
        p_target_user_id::TEXT, p_target_user_id,
        JSONB_BUILD_OBJECT(
            'target_user_id', p_target_user_id,
            'freeze_reason', v_clean_reason,
            'frozen_at', NOW()
        ),
        NOW()
    );

    RETURN JSONB_BUILD_OBJECT(
        'success', TRUE,
        'target_user_id', p_target_user_id,
        'is_emergency_frozen', TRUE,
        'reason', v_clean_reason
    );
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_unfreeze_user_authorized(
    p_target_user_id UUID,
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
    v_clean_reason TEXT := COALESCE(NULLIF(BTRIM(p_reason), ''), 'Admin unfreeze');
BEGIN
    IF auth.role() IS DISTINCT FROM 'service_role' THEN
        RAISE EXCEPTION 'Unauthorized: trusted server execution required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_actor_id IS NULL OR p_target_user_id IS NULL THEN
        RAISE EXCEPTION 'Target and authenticated administrator actor are required.'
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

    UPDATE public.profiles
       SET is_emergency_frozen = FALSE,
           emergency_frozen_at = NULL,
           emergency_frozen_by = NULL,
           emergency_freeze_reason = NULL,
           updated_at = NOW()
     WHERE id = p_target_user_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target user not found.'
            USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.admin_audit_logs (
        admin_id, admin_email, action, target_id, target_user_id, details, created_at
    ) VALUES (
        p_actor_id, v_actor_email, 'USER_EMERGENCY_UNFREEZE',
        p_target_user_id::TEXT, p_target_user_id,
        JSONB_BUILD_OBJECT(
            'target_user_id', p_target_user_id,
            'unfreeze_reason', v_clean_reason,
            'unfrozen_at', NOW()
        ),
        NOW()
    );

    RETURN JSONB_BUILD_OBJECT(
        'success', TRUE,
        'target_user_id', p_target_user_id,
        'is_emergency_frozen', FALSE
    );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_freeze_user_authorized(UUID, TEXT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_unfreeze_user_authorized(UUID, TEXT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_freeze_user_authorized(UUID, TEXT, UUID, TEXT)
    TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.admin_unfreeze_user_authorized(UUID, TEXT, UUID, TEXT)
    TO service_role, postgres;

COMMIT;
