-- Restore server-only administrator role/status and emergency-freeze RPCs.
-- Actor identity uses the strict canonical full-admin helper. Role changes are
-- serialized and protect the final active administrator; support sessions are
-- revoked on promotion, restriction, suspension, ban and emergency freeze.
BEGIN;
DO $precheck$
BEGIN
  IF to_regprocedure('public.is_active_full_admin_actor(uuid)') IS NULL
     OR to_regclass('public.app_admins') IS NULL
     OR to_regclass('public.support_admin_grants') IS NULL
     OR to_regclass('public.support_admin_emergency_sessions') IS NULL
     OR to_regclass('public.advertisements') IS NULL
     OR to_regclass('public.ads') IS NULL
     OR to_regclass('public.p2p_ads') IS NULL
     OR to_regclass('public.admin_audit_logs') IS NULL THEN
    RAISE EXCEPTION 'A required admin, support, advertisement or audit dependency is missing.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_admins' AND column_name='user_id')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='app_admins' AND column_name='granted_at') THEN
    RAISE EXCEPTION 'app_admins schema does not match user_id/granted_at.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid JOIN pg_namespace n ON n.oid=t.typnamespace
                 WHERE n.nspname='public' AND t.typname='user_status_enum' AND e.enumlabel='restricted') THEN
    RAISE EXCEPTION 'The restricted user_status_enum label must be committed first.';
  END IF;
END;
$precheck$;
CREATE OR REPLACE FUNCTION public.admin_update_user_role_authorized(
    p_admin_id UUID,
    p_admin_email TEXT,
    p_target_user_id UUID,
    p_new_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_actor_email TEXT;
    v_supplied_email TEXT := NULLIF(BTRIM(p_admin_email), '');
    v_new_role TEXT := LOWER(BTRIM(COALESCE(p_new_role, '')));
    v_target_profile public.profiles%ROWTYPE;
    v_was_admin BOOLEAN := FALSE;
    v_other_active_admins BIGINT := 0;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Trusted server execution required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_admin_id IS NULL OR p_target_user_id IS NULL THEN
        RAISE EXCEPTION 'Administrator and target user are required.'
            USING ERRCODE = '22023';
    END IF;

    IF p_admin_id = p_target_user_id THEN
        RAISE EXCEPTION 'Self-modification of administrative privileges is prohibited.'
            USING ERRCODE = '42501';
    END IF;

    IF v_new_role NOT IN ('admin', 'user') THEN
        RAISE EXCEPTION 'Role must be admin or user.'
            USING ERRCODE = '22023';
    END IF;

    IF NOT public.is_active_full_admin_actor(p_admin_id) THEN
        RAISE EXCEPTION 'A full, active administrator grant is required.'
            USING ERRCODE = '42501';
    END IF;

    SELECT NULLIF(BTRIM(u.email), '')
      INTO v_actor_email
      FROM auth.users AS u
     WHERE u.id = p_admin_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Administrator Auth account was not found.'
            USING ERRCODE = '42501';
    END IF;

    IF v_actor_email IS NOT NULL
       AND v_supplied_email IS NOT NULL
       AND LOWER(v_actor_email) <> LOWER(v_supplied_email) THEN
        RAISE EXCEPTION 'Administrator email does not match the canonical Auth email.'
            USING ERRCODE = '42501';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(1380011313, 1);

    SELECT p.* INTO v_target_profile
      FROM public.profiles AS p
     WHERE p.id = p_target_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target user not found.' USING ERRCODE = 'P0002';
    END IF;

    SELECT (
      COALESCE(v_target_profile.is_admin,FALSE)
      OR COALESCE(v_target_profile.is_admin_account,FALSE)
      OR LOWER(COALESCE(v_target_profile.role::TEXT,''))='admin'
      OR EXISTS (SELECT 1 FROM public.app_admins aa WHERE aa.user_id=p_target_user_id)
      OR EXISTS (
        SELECT 1 FROM auth.users target_auth
        WHERE target_auth.id=p_target_user_id
          AND (LOWER(COALESCE(target_auth.raw_app_meta_data->>'role',''))='admin'
            OR LOWER(COALESCE(target_auth.raw_app_meta_data->>'is_admin','false')) IN ('true','1'))
      )
    ) INTO v_was_admin;

    IF v_new_role='admin' AND (
      LOWER(COALESCE(v_target_profile.status::TEXT,'')) <> 'active'
      OR (v_target_profile.account_status IS NOT NULL AND LOWER(v_target_profile.account_status)<>'active')
      OR COALESCE(v_target_profile.is_banned,FALSE)
      OR COALESCE(v_target_profile.is_suspended,FALSE)
      OR COALESCE(v_target_profile.is_restricted,FALSE)
      OR COALESCE(v_target_profile.is_on_hold,FALSE)
      OR COALESCE(v_target_profile.is_emergency_frozen,FALSE)
      OR COALESCE(v_target_profile.is_minor_restricted,FALSE)
    ) THEN
      RAISE EXCEPTION 'Only an active, unrestricted account can be promoted to administrator.' USING ERRCODE='42501';
    END IF;

    IF v_new_role='user' AND v_was_admin THEN
      SELECT COUNT(*) INTO v_other_active_admins
      FROM public.profiles other_profile
      WHERE other_profile.id<>p_target_user_id
        AND public.is_active_full_admin_actor(other_profile.id);
      IF v_other_active_admins<1 THEN
        RAISE EXCEPTION 'The last active administrator cannot be demoted.' USING ERRCODE='23514';
      END IF;
    END IF;

    IF v_new_role='admin' THEN
      UPDATE public.support_admin_emergency_sessions
      SET revoked_at=clock_timestamp(),
          revoke_reason='Support-admin access ended by full-admin promotion'
      WHERE support_admin_id=p_target_user_id AND revoked_at IS NULL;
      UPDATE public.support_admin_grants
      SET is_enabled=FALSE, updated_at=clock_timestamp()
      WHERE user_id=p_target_user_id AND is_enabled IS TRUE;
    END IF;

    UPDATE public.profiles
       SET role = v_new_role::public.user_role,
           is_admin = (v_new_role = 'admin'),
           is_admin_account = (v_new_role = 'admin'),
           updated_at = NOW()
     WHERE id = p_target_user_id;

    IF v_new_role = 'admin' THEN
        INSERT INTO public.app_admins (user_id, granted_at)
        VALUES (p_target_user_id, NOW())
        ON CONFLICT (user_id) DO UPDATE SET granted_at=EXCLUDED.granted_at;
    ELSE
        DELETE FROM public.app_admins
         WHERE user_id = p_target_user_id;
    END IF;

    -- Keep the server-managed Auth app metadata synchronized with the durable
    -- profile/admin registry so legacy policies and JWT claims cannot retain a
    -- stale administrator grant after demotion.
    UPDATE auth.users
       SET raw_app_meta_data = CASE
           WHEN v_new_role = 'admin' THEN
               (COALESCE(raw_app_meta_data, '{}'::JSONB) - 'role' - 'is_admin')
               || JSONB_BUILD_OBJECT('role', 'admin', 'is_admin', TRUE)
           ELSE
               COALESCE(raw_app_meta_data, '{}'::JSONB) - 'role' - 'is_admin'
       END
     WHERE id = p_target_user_id;

    INSERT INTO public.admin_audit_logs (
        admin_id, admin_email, action, target_id, target_user_id, details, created_at
    ) VALUES (
        p_admin_id,
        v_actor_email,
        'UPDATE_USER_ROLE',
        p_target_user_id::TEXT,
        p_target_user_id,
        JSONB_BUILD_OBJECT(
            'new_role', v_new_role,
            'updated_by', p_admin_id,
            'timestamp', NOW()
        ),
        NOW()
    );

    RETURN JSONB_BUILD_OBJECT(
        'success', TRUE,
        'target_user_id', p_target_user_id,
        'role', v_new_role,
        'actor_id', p_admin_id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_update_user_status_authorized(
    p_admin_id UUID,
    p_admin_email TEXT,
    p_target_user_id UUID,
    p_status public.user_status_enum,
    p_ban_reason TEXT DEFAULT NULL,
    p_ban_policy public.ban_withdrawal_policy_enum DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_actor_email TEXT;
    v_supplied_email TEXT := NULLIF(BTRIM(p_admin_email), '');
    v_reason TEXT := NULLIF(BTRIM(p_ban_reason), '');
    v_ban_policy public.ban_withdrawal_policy_enum;
    v_target_profile public.profiles%ROWTYPE;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Trusted server execution required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_admin_id IS NULL OR p_target_user_id IS NULL OR p_status IS NULL THEN
        RAISE EXCEPTION 'Administrator, target user, and status are required.'
            USING ERRCODE = '22023';
    END IF;

    IF p_admin_id = p_target_user_id THEN
        RAISE EXCEPTION 'Administrators cannot change their own account status through this operation.'
            USING ERRCODE = '42501';
    END IF;

    IF p_status::TEXT NOT IN ('active', 'restricted', 'suspended', 'banned') THEN
        RAISE EXCEPTION 'Unsupported administrative account status.'
            USING ERRCODE = '22023';
    END IF;

    IF p_status = 'banned'::public.user_status_enum THEN
        IF v_reason IS NULL OR LENGTH(v_reason) < 10 OR LENGTH(v_reason) > 1000 THEN
            RAISE EXCEPTION 'A ban reason between 10 and 1000 characters is required.'
                USING ERRCODE = '22023';
        END IF;
        v_ban_policy := COALESCE(
            p_ban_policy,
            'permanent_freeze'::public.ban_withdrawal_policy_enum
        );
    ELSE
        v_ban_policy := NULL;
        IF v_reason IS NOT NULL AND LENGTH(v_reason) > 1000 THEN
            RAISE EXCEPTION 'Reason must contain 1000 characters or fewer.'
                USING ERRCODE = '22023';
        END IF;
    END IF;

    IF NOT public.is_active_full_admin_actor(p_admin_id) THEN
        RAISE EXCEPTION 'A full, active administrator grant is required.'
            USING ERRCODE = '42501';
    END IF;

    SELECT NULLIF(BTRIM(u.email), '')
      INTO v_actor_email
      FROM auth.users AS u
     WHERE u.id = p_admin_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Administrator Auth account was not found.'
            USING ERRCODE = '42501';
    END IF;

    IF v_actor_email IS NOT NULL
       AND v_supplied_email IS NOT NULL
       AND LOWER(v_actor_email) <> LOWER(v_supplied_email) THEN
        RAISE EXCEPTION 'Administrator email does not match the canonical Auth email.'
            USING ERRCODE = '42501';
    END IF;

    SELECT p.* INTO v_target_profile
      FROM public.profiles AS p
     WHERE p.id=p_target_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target user not found.' USING ERRCODE='P0002';
    END IF;

    IF COALESCE(v_target_profile.is_admin,FALSE)
       OR COALESCE(v_target_profile.is_admin_account,FALSE)
       OR LOWER(COALESCE(v_target_profile.role::TEXT,''))='admin'
       OR EXISTS (SELECT 1 FROM public.app_admins aa WHERE aa.user_id=p_target_user_id)
       OR EXISTS (
          SELECT 1 FROM auth.users target_auth
          WHERE target_auth.id=p_target_user_id
            AND (LOWER(COALESCE(target_auth.raw_app_meta_data->>'role',''))='admin'
              OR LOWER(COALESCE(target_auth.raw_app_meta_data->>'is_admin','false')) IN ('true','1'))
       ) THEN
      RAISE EXCEPTION 'Demote a full administrator through the dedicated role operation before changing account status.' USING ERRCODE='42501';
    END IF;

    UPDATE public.profiles
       SET status = p_status,
           account_status = p_status::TEXT,
           is_banned = (p_status = 'banned'::public.user_status_enum),
           is_restricted = (p_status = 'restricted'::public.user_status_enum),
           is_suspended = (p_status = 'suspended'::public.user_status_enum),
           ban_reason = CASE
               WHEN p_status = 'banned'::public.user_status_enum THEN v_reason
               ELSE NULL
           END,
           ban_policy = v_ban_policy,
           banned_at = CASE
               WHEN p_status = 'banned'::public.user_status_enum THEN COALESCE(banned_at,NOW())
               ELSE NULL
           END,
           suspension_reason = CASE
               WHEN p_status IN (
                   'restricted'::public.user_status_enum,
                   'suspended'::public.user_status_enum
               ) THEN v_reason
               ELSE NULL
           END,
           status_operation_id = NULL,
           updated_at = NOW()
     WHERE id = p_target_user_id;

    IF p_status IN (
        'restricted'::public.user_status_enum,
        'suspended'::public.user_status_enum,
        'banned'::public.user_status_enum
    ) THEN
        UPDATE public.advertisements
           SET is_active=FALSE
         WHERE user_id=p_target_user_id;

        UPDATE public.ads
           SET active=FALSE, is_active=FALSE, status='paused'
         WHERE user_id=p_target_user_id;

        UPDATE public.p2p_ads
           SET active=FALSE, is_active=FALSE, status='paused'
         WHERE user_id=p_target_user_id;

        UPDATE public.support_admin_emergency_sessions
        SET revoked_at=clock_timestamp(),
            revoke_reason='Support-admin account status changed to ' || p_status::TEXT
        WHERE support_admin_id=p_target_user_id AND revoked_at IS NULL;
        UPDATE public.support_admin_grants
        SET is_enabled=FALSE, updated_at=clock_timestamp()
        WHERE user_id=p_target_user_id AND is_enabled IS TRUE;
    END IF;

    INSERT INTO public.admin_audit_logs (
        admin_id, admin_email, action, target_id, target_user_id, details, created_at
    ) VALUES (
        p_admin_id,
        v_actor_email,
        'UPDATE_USER_STATUS',
        p_target_user_id::TEXT,
        p_target_user_id,
        JSONB_BUILD_OBJECT(
            'new_status', p_status::TEXT,
            'ban_reason', v_reason,
            'ban_policy', v_ban_policy,
            'actor_id', p_admin_id
        ),
        NOW()
    );

    RETURN JSONB_BUILD_OBJECT(
        'success', TRUE,
        'target_user_id', p_target_user_id,
        'status', p_status::TEXT,
        'ban_policy', v_ban_policy,
        'actor_id', p_admin_id
    );
END;
$function$;

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
AS $function$
DECLARE
    v_actor_email TEXT;
    v_supplied_email TEXT := NULLIF(BTRIM(p_actor_email), '');
    v_reason TEXT := NULLIF(BTRIM(p_reason), '');
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Trusted server execution required.' USING ERRCODE = '42501';
    END IF;
    IF p_actor_id IS NULL OR p_target_user_id IS NULL OR p_target_user_id = p_actor_id THEN
        RAISE EXCEPTION 'A different target and active administrator actor are required.' USING ERRCODE = '42501';
    END IF;
    IF v_reason IS NULL OR LENGTH(v_reason) < 3 OR LENGTH(v_reason) > 1000 THEN
        RAISE EXCEPTION 'A reason between 3 and 1000 characters is required.' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_active_full_admin_actor(p_actor_id) THEN
        RAISE EXCEPTION 'A full, active administrator grant is required.' USING ERRCODE = '42501';
    END IF;

    SELECT NULLIF(BTRIM(u.email), '') INTO v_actor_email
      FROM auth.users AS u WHERE u.id = p_actor_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Administrator Auth account was not found.' USING ERRCODE = '42501';
    END IF;
    IF v_actor_email IS NOT NULL AND v_supplied_email IS NOT NULL
       AND LOWER(v_actor_email) <> LOWER(v_supplied_email) THEN
        RAISE EXCEPTION 'Administrator email does not match canonical Auth email.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.profiles
       SET is_emergency_frozen=TRUE,
           emergency_frozen_at=NOW(),
           emergency_frozen_by=p_actor_id,
           emergency_freeze_reason=v_reason,
           updated_at=NOW()
     WHERE id=p_target_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target user not found.' USING ERRCODE='P0002';
    END IF;
    UPDATE public.advertisements
       SET is_active=FALSE
     WHERE user_id=p_target_user_id;

    UPDATE public.ads
       SET active=FALSE, is_active=FALSE, status='paused'
     WHERE user_id=p_target_user_id;

    UPDATE public.p2p_ads
       SET active=FALSE, is_active=FALSE, status='paused'
     WHERE user_id=p_target_user_id;

    UPDATE public.support_admin_emergency_sessions
       SET revoked_at=clock_timestamp(),
           revoke_reason='Support-admin account emergency frozen'
     WHERE support_admin_id=p_target_user_id AND revoked_at IS NULL;

    UPDATE public.support_admin_grants
       SET is_enabled=FALSE, updated_at=clock_timestamp()
     WHERE user_id=p_target_user_id AND is_enabled IS TRUE;

    INSERT INTO public.admin_audit_logs
        (admin_id, admin_email, action, target_id, target_user_id, details, created_at)
    VALUES (
        p_actor_id, v_actor_email, 'USER_EMERGENCY_FREEZE',
        p_target_user_id::TEXT, p_target_user_id,
        JSONB_BUILD_OBJECT('target_user_id', p_target_user_id, 'freeze_reason', v_reason, 'frozen_at', NOW()),
        NOW()
    );

    RETURN JSONB_BUILD_OBJECT('success', TRUE, 'target_user_id', p_target_user_id, 'is_emergency_frozen', TRUE);
END;
$function$;

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
AS $function$
DECLARE
    v_actor_email TEXT;
    v_supplied_email TEXT := NULLIF(BTRIM(p_actor_email), '');
    v_reason TEXT := COALESCE(NULLIF(BTRIM(p_reason), ''), 'Admin unfreeze');
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Trusted server execution required.' USING ERRCODE = '42501';
    END IF;
    IF p_actor_id IS NULL OR p_target_user_id IS NULL OR p_target_user_id=p_actor_id THEN
        RAISE EXCEPTION 'Target and administrator actor are required.' USING ERRCODE = '22023';
    END IF;
    IF LENGTH(v_reason) > 1000 THEN
        RAISE EXCEPTION 'Reason must be 1000 characters or fewer.' USING ERRCODE = '22023';
    END IF;
    IF NOT public.is_active_full_admin_actor(p_actor_id) THEN
        RAISE EXCEPTION 'A full, active administrator grant is required.' USING ERRCODE = '42501';
    END IF;

    SELECT NULLIF(BTRIM(u.email), '') INTO v_actor_email
      FROM auth.users AS u WHERE u.id = p_actor_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Administrator Auth account was not found.' USING ERRCODE = '42501';
    END IF;
    IF v_actor_email IS NOT NULL AND v_supplied_email IS NOT NULL
       AND LOWER(v_actor_email) <> LOWER(v_supplied_email) THEN
        RAISE EXCEPTION 'Administrator email does not match canonical Auth email.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.profiles
       SET is_emergency_frozen=FALSE,
           emergency_frozen_at=NULL,
           emergency_frozen_by=NULL,
           emergency_freeze_reason=NULL,
           updated_at=NOW()
     WHERE id=p_target_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Target user not found.' USING ERRCODE='P0002';
    END IF;
    UPDATE public.support_admin_emergency_sessions
       SET revoked_at=clock_timestamp(),
           revoke_reason='Support-admin account unfrozen; previous session must not resume'
     WHERE support_admin_id=p_target_user_id AND revoked_at IS NULL;

    INSERT INTO public.admin_audit_logs
        (admin_id, admin_email, action, target_id, target_user_id, details, created_at)
    VALUES (
        p_actor_id, v_actor_email, 'USER_EMERGENCY_UNFREEZE',
        p_target_user_id::TEXT, p_target_user_id,
        JSONB_BUILD_OBJECT('target_user_id', p_target_user_id, 'unfreeze_reason', v_reason, 'unfrozen_at', NOW()),
        NOW()
    );

    RETURN JSONB_BUILD_OBJECT('success', TRUE, 'target_user_id', p_target_user_id, 'is_emergency_frozen', FALSE);
END;
$function$;

ALTER FUNCTION public.admin_update_user_role_authorized(uuid,text,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.admin_update_user_status_authorized(uuid,text,uuid,public.user_status_enum,text,public.ban_withdrawal_policy_enum) OWNER TO postgres;
ALTER FUNCTION public.admin_freeze_user_authorized(uuid,text,uuid,text) OWNER TO postgres;
ALTER FUNCTION public.admin_unfreeze_user_authorized(uuid,text,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_update_user_role_authorized(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,supabase_auth_admin;
REVOKE ALL ON FUNCTION public.admin_update_user_status_authorized(uuid,text,uuid,public.user_status_enum,text,public.ban_withdrawal_policy_enum) FROM PUBLIC,anon,authenticated,supabase_auth_admin;
REVOKE ALL ON FUNCTION public.admin_freeze_user_authorized(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,supabase_auth_admin;
REVOKE ALL ON FUNCTION public.admin_unfreeze_user_authorized(uuid,text,uuid,text) FROM PUBLIC,anon,authenticated,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role_authorized(uuid,text,uuid,text) TO service_role,postgres;
GRANT EXECUTE ON FUNCTION public.admin_update_user_status_authorized(uuid,text,uuid,public.user_status_enum,text,public.ban_withdrawal_policy_enum) TO service_role,postgres;
GRANT EXECUTE ON FUNCTION public.admin_freeze_user_authorized(uuid,text,uuid,text) TO service_role,postgres;
GRANT EXECUTE ON FUNCTION public.admin_unfreeze_user_authorized(uuid,text,uuid,text) TO service_role,postgres;
REVOKE ALL ON FUNCTION public.admin_update_user_role(uuid,uuid,text) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role(uuid,uuid,text) TO postgres;
REVOKE ALL ON FUNCTION public.admin_update_user_status(text,uuid,public.user_status_enum,text,public.ban_withdrawal_policy_enum) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.admin_update_user_status(text,uuid,public.user_status_enum,text,public.ban_withdrawal_policy_enum) TO postgres;
REVOKE ALL ON FUNCTION public.admin_freeze_user(uuid,text) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.admin_freeze_user(uuid,text) TO postgres;
REVOKE ALL ON FUNCTION public.admin_unfreeze_user(uuid,text) FROM PUBLIC,anon,authenticated,service_role,supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.admin_unfreeze_user(uuid,text) TO postgres;
COMMIT;
