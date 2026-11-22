-- Harden administrative user mutations and reconcile the live app_admins shape.
-- This migration is intentionally service-role mediated: the Next.js server verifies
-- the administrator's signed session/2FA, and these RPCs independently re-check the
-- durable administrator registry before changing privileged account state.
-- Candidate only: reconcile the production migration history and replay the complete
-- chain on a schema-faithful disposable database before any production application.

BEGIN;

-- Production has user_id + granted_at, while several current canonical migrations
-- write role + created_at. Preserve the existing fields and make both generations
-- of the schema compatible without changing existing administrator membership.
ALTER TABLE public.app_admins
    ADD COLUMN IF NOT EXISTS role TEXT,
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

UPDATE public.app_admins
   SET role = COALESCE(NULLIF(BTRIM(role), ''), 'admin'),
       created_at = COALESCE(created_at, granted_at, NOW())
 WHERE role IS NULL
    OR NULLIF(BTRIM(role), '') IS NULL
    OR created_at IS NULL;

ALTER TABLE public.app_admins
    ALTER COLUMN role SET DEFAULT 'admin',
    ALTER COLUMN role SET NOT NULL,
    ALTER COLUMN created_at SET DEFAULT NOW(),
    ALTER COLUMN created_at SET NOT NULL;

DO $app_admins_role_check$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_constraint
         WHERE conrelid = 'public.app_admins'::regclass
           AND conname = 'app_admins_role_check'
    ) THEN
        ALTER TABLE public.app_admins
            ADD CONSTRAINT app_admins_role_check
            CHECK (role IN ('superadmin', 'admin', 'support', 'compliance')) NOT VALID;
    END IF;
END;
$app_admins_role_check$;

ALTER TABLE public.app_admins
    VALIDATE CONSTRAINT app_admins_role_check;

-- Make the shared administrator predicate fail closed. A profile that is
-- suspended, banned, restricted, on hold, minor-restricted, frozen, inactive,
-- or deleted must not retain elevated administrative authority merely because
-- a stale role/app_metadata/app_admins grant still exists.
CREATE OR REPLACE FUNCTION public.check_is_admin(
    p_user_id UUID DEFAULT NULL,
    user_uuid UUID DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_uid UUID := COALESCE(p_user_id, user_uuid, auth.uid());
    v_profile_role TEXT;
    v_is_admin_flag BOOLEAN := FALSE;
    v_is_admin_account BOOLEAN := FALSE;
    v_is_banned BOOLEAN := FALSE;
    v_is_suspended BOOLEAN := FALSE;
    v_is_restricted BOOLEAN := FALSE;
    v_is_frozen BOOLEAN := FALSE;
    v_is_minor_restricted BOOLEAN := FALSE;
    v_status TEXT;
    v_account_status TEXT;
    v_app_role TEXT := '';
    v_app_is_admin BOOLEAN := FALSE;
BEGIN
    IF v_uid IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT
        p.role::TEXT,
        COALESCE(p.is_admin, FALSE),
        COALESCE(p.is_admin_account, FALSE),
        COALESCE(p.is_banned, FALSE),
        COALESCE(p.is_suspended, FALSE) OR COALESCE(p.is_on_hold, FALSE),
        COALESCE(p.is_restricted, FALSE),
        COALESCE(p.is_emergency_frozen, FALSE),
        COALESCE(p.is_minor_restricted, FALSE),
        LOWER(COALESCE(p.status::TEXT, '')),
        LOWER(COALESCE(p.account_status, ''))
    INTO
        v_profile_role,
        v_is_admin_flag,
        v_is_admin_account,
        v_is_banned,
        v_is_suspended,
        v_is_restricted,
        v_is_frozen,
        v_is_minor_restricted,
        v_status,
        v_account_status
    FROM public.profiles AS p
    WHERE p.id = v_uid;

    IF NOT FOUND THEN
        RETURN FALSE;
    END IF;

    IF v_is_banned
       OR v_is_suspended
       OR v_is_restricted
       OR v_is_frozen
       OR v_is_minor_restricted
       OR v_status IS DISTINCT FROM 'active'
       OR v_account_status IS DISTINCT FROM 'active'
       OR v_account_status IN (
           'banned', 'suspended', 'restricted', 'deleted',
           'inactive', 'on_hold', 'hold', 'deletion_pending'
       ) THEN
        RETURN FALSE;
    END IF;

    -- raw_app_meta_data is server-managed by Supabase Auth; unlike raw_user_meta_data,
    -- it is not user-editable. It remains a valid legacy bootstrap source only
    -- after all durable account-state restrictions above have passed.
    SELECT
        COALESCE(u.raw_app_meta_data->>'role', ''),
        COALESCE((u.raw_app_meta_data->>'is_admin')::BOOLEAN, FALSE)
    INTO v_app_role, v_app_is_admin
    FROM auth.users AS u
    WHERE u.id = v_uid;

    IF (v_is_admin_flag IS TRUE)
       OR (v_is_admin_account IS TRUE)
       OR LOWER(COALESCE(v_profile_role, '')) = 'admin'
       OR LOWER(COALESCE(v_app_role, '')) = 'admin'
       OR v_app_is_admin IS TRUE
       OR EXISTS (
           SELECT 1
           FROM public.app_admins AS aa
           WHERE aa.user_id = v_uid
             AND LOWER(COALESCE(aa.role, '')) IN ('admin', 'superadmin')
       ) THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$function$;

ALTER FUNCTION public.check_is_admin(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.check_is_admin(UUID, UUID)
    FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_is_admin(UUID, UUID)
    TO service_role, postgres, supabase_auth_admin;

-- Keep the SQL helper used by RLS and user-context RPCs aligned with the
-- stricter server-side predicate. service_role remains an explicit trusted path.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
    SELECT
        COALESCE(auth.role(), '') = 'service_role'
        OR (
            auth.uid() IS NOT NULL
            AND public.check_is_admin(auth.uid(), NULL)
        );
$function$;

ALTER FUNCTION public.is_admin() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin()
    TO authenticated, service_role, postgres, supabase_auth_admin;

-- The new-trade escrow RPC also allowed a role-flag shortcut during
-- maintenance and checked only some account holds after idempotency replay.
-- Gate identity/account state before any replay and bind maintenance bypass to
-- the canonical active-admin predicate.
DO $trade_initiation_active_actor$
DECLARE
    v_oid OID;
    v_definition TEXT;
    v_updated TEXT;
    v_pattern TEXT;
    v_replacement TEXT;
BEGIN
    SELECT p.oid INTO v_oid
      FROM pg_proc AS p
      JOIN pg_namespace AS n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = 'initiate_trade_with_escrow'
       AND p.prosecdef;
    IF v_oid IS NULL THEN
        RAISE EXCEPTION 'Required initiate_trade_with_escrow RPC is missing.';
    END IF;

    v_definition := pg_get_functiondef(v_oid);

    v_pattern := $re$SELECT EXISTS\s*\(\s*SELECT 1 FROM public[.]profiles\s+WHERE id = v_effective_caller\s+AND \(role = 'admin' OR is_admin = TRUE OR is_admin_account = TRUE\)\s*\) INTO v_is_caller_admin;$re$;
    IF regexp_count(v_definition, v_pattern, 1, 'is') <> 1 THEN
        RAISE EXCEPTION 'Unexpected maintenance-mode admin predicate; refusing to rewrite trade initiation RPC.';
    END IF;
    v_replacement := 'v_is_caller_admin := public.check_is_admin(v_effective_caller, NULL);';
    v_updated := regexp_replace(v_definition, v_pattern, v_replacement, 1, 1, 'is');
    IF v_updated = v_definition THEN
        RAISE EXCEPTION 'Failed to replace trade initiation maintenance admin predicate.';
    END IF;
    v_definition := v_updated;

    -- Stop restricted/held/inactive account retries before the early
    -- idempotency lookup can return a prior trade response.
    v_pattern := $re$-- 1[.]1 Strict Idempotency Key Validation\s+v_clean_idempotency := NULLIF\(TRIM\(COALESCE\(p_idempotency_key, ''\)\), ''\);$re$;
    IF regexp_count(v_definition, v_pattern, 1, 'is') <> 1 THEN
        RAISE EXCEPTION 'Unexpected trade idempotency guard location; refusing account-state rewrite.';
    END IF;
    v_replacement := $replacement$IF NOT EXISTS (
        SELECT 1
          FROM public.profiles AS p
         WHERE p.id = v_effective_caller
           AND LOWER(COALESCE(p.status::TEXT, '')) = 'active'
           AND LOWER(COALESCE(p.account_status, '')) = 'active'
           AND COALESCE(p.is_banned, FALSE) = FALSE
           AND COALESCE(p.is_restricted, FALSE) = FALSE
           AND COALESCE(p.is_suspended, FALSE) = FALSE
           AND COALESCE(p.is_on_hold, FALSE) = FALSE
           AND COALESCE(p.is_emergency_frozen, FALSE) = FALSE
           AND COALESCE(p.is_minor_restricted, FALSE) = FALSE
    ) THEN
        RAISE EXCEPTION 'ACCOUNT_NOT_ELIGIBLE: Account is not active or is restricted from platform actions.'
            USING ERRCODE = 'P0001', DETAIL = 'ACCOUNT_NOT_ELIGIBLE';
    END IF;

    -- 1.1 Strict Idempotency Key Validation
    v_clean_idempotency := NULLIF(TRIM(COALESCE(p_idempotency_key, '')), '');$replacement$;
    v_updated := regexp_replace(v_definition, v_pattern, v_replacement, 1, 1, 'is');
    IF v_updated = v_definition THEN
        RAISE EXCEPTION 'Failed to insert pre-idempotency account guard.';
    END IF;
    v_definition := v_updated;

    -- The later locked caller/counterparty eligibility checks must include
    -- on-hold state and the canonical status enum, not just account_status.
    v_pattern := $re$OR COALESCE\(p[.]is_minor_restricted, FALSE\)\s+OR p[.]account_status IS NULL\s+OR LOWER\(BTRIM\(p[.]account_status\)\) <> 'active'\)$re$;
    IF regexp_count(v_definition, v_pattern, 1, 'is') <> 2 THEN
        RAISE EXCEPTION 'Expected both locked trade participant account checks; found an unexpected count.';
    END IF;
    v_replacement := $replacement$OR COALESCE(p.is_minor_restricted, FALSE)
            OR COALESCE(p.is_on_hold, FALSE)
            OR p.status IS DISTINCT FROM 'active'::public.user_status_enum
            OR p.account_status IS NULL
            OR LOWER(BTRIM(p.account_status)) <> 'active')$replacement$;
    v_updated := regexp_replace(v_definition, v_pattern, v_replacement, 1, 2, 'is');
    IF v_updated = v_definition THEN
        RAISE EXCEPTION 'Failed to harden locked participant account checks.';
    END IF;

    EXECUTE v_updated;
END;
$trade_initiation_active_actor$;

-- Trade RPCs carried independent admin shortcuts (app_admins and raw app
-- metadata) after the common is_admin() call. Replace those duplicated grants
-- with the exact database predicate so banned/restricted/frozen/inactive actors
-- cannot bypass the shared state gate through a second OR branch.
DO $trade_rpc_admin_predicate$
DECLARE
    v_name TEXT;
    v_oid OID;
    v_definition TEXT;
    v_updated TEXT;
    v_caller_expression TEXT;
    v_pattern CONSTANT TEXT := $re$v_is_admin[[:space:]]*:=[[:space:]]*public[.]is_admin[(][)][[:space:][:print:]]*?;$re$;
BEGIN
    FOREACH v_name IN ARRAY ARRAY[
        'cancel_p2p_trade',
        'mark_p2p_trade_paid',
        'raise_trade_dispute'
    ] LOOP
        SELECT p.oid
          INTO v_oid
          FROM pg_proc AS p
          JOIN pg_namespace AS n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = v_name
           AND p.prosecdef;

        IF v_oid IS NULL THEN
            RAISE EXCEPTION 'Required trade authorization RPC % is missing.', v_name;
        END IF;

        v_caller_expression := CASE
            WHEN v_name IN ('cancel_p2p_trade', 'mark_p2p_trade_paid')
                THEN 'v_effective_caller'
            WHEN v_name = 'raise_trade_dispute'
                THEN 'v_caller_id'
            ELSE NULL
        END;

        IF v_caller_expression IS NULL THEN
            RAISE EXCEPTION 'No verified caller mapping exists for trade RPC %.', v_name;
        END IF;

        v_definition := pg_get_functiondef(v_oid);

        IF position(
            ('public.check_is_admin(' || v_caller_expression || ', NULL)')
            IN v_definition
        ) > 0 THEN
            CONTINUE;
        END IF;

        IF regexp_count(v_definition, v_pattern, 1, 'is') <> 1 THEN
            RAISE EXCEPTION
                'Trade RPC % has an unexpected admin predicate; refusing an unsafe rewrite.',
                v_name;
        END IF;

        v_updated := regexp_replace(
            v_definition,
            v_pattern,
            'v_is_admin := public.check_is_admin(' || v_caller_expression || ', NULL);',
            1,
            1,
            'is'
        );

        IF v_updated = v_definition
           OR position(
               ('v_is_admin := public.check_is_admin(' || v_caller_expression || ', NULL);')
               IN v_updated
           ) = 0 THEN
            RAISE EXCEPTION 'Failed to install canonical admin predicate in %.', v_name;
        END IF;

        EXECUTE v_updated;
    END LOOP;
END;
$trade_rpc_admin_predicate$;

-- Login-time admin verification must share the same active-admin predicate.
-- Do not let legacy app_metadata or a stale app_admins row bypass account holds.
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
SET search_path = ''
AS $function$
DECLARE
    v_uid UUID := COALESCE(p_user_uuid, user_uuid, auth.uid());
    v_profile_role TEXT;
    v_suspended BOOLEAN := FALSE;
BEGIN
    IF v_uid IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, FALSE, 'User ID is required.'::TEXT;
        RETURN;
    END IF;

    IF COALESCE(auth.role(), '') <> 'service_role'
       AND (auth.uid() IS NULL OR v_uid IS DISTINCT FROM auth.uid()) THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, FALSE,
            'User ID must match the authenticated account.'::TEXT;
        RETURN;
    END IF;

    SELECT
        p.role::TEXT,
        COALESCE(p.is_banned, FALSE)
          OR COALESCE(p.is_suspended, FALSE)
          OR COALESCE(p.is_on_hold, FALSE)
          OR COALESCE(p.is_restricted, FALSE)
          OR COALESCE(p.is_emergency_frozen, FALSE)
          OR LOWER(COALESCE(p.status::TEXT, '')) IS DISTINCT FROM 'active'
          OR LOWER(COALESCE(p.account_status, '')) IS DISTINCT FROM 'active'
          OR LOWER(COALESCE(p.account_status, '')) IN (
              'banned', 'suspended', 'restricted', 'deleted',
              'inactive', 'on_hold', 'hold', 'deletion_pending'
          )
    INTO v_profile_role, v_suspended
    FROM public.profiles AS p
    WHERE p.id = v_uid;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, NULL::TEXT, FALSE, 'User profile not found.'::TEXT;
        RETURN;
    END IF;

    IF NOT public.check_is_admin(v_uid, NULL) THEN
        RETURN QUERY SELECT
            FALSE,
            COALESCE(v_profile_role, 'user'),
            COALESCE(v_suspended, FALSE),
            'User does not have active full administrator privileges.'::TEXT;
        RETURN;
    END IF;

    RETURN QUERY SELECT TRUE, COALESCE(v_profile_role, 'admin'), FALSE, NULL::TEXT;
END;
$function$;

ALTER FUNCTION public.verify_admin_login(UUID, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.verify_admin_login(UUID, UUID)
    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_admin_login(UUID, UUID)
    TO authenticated, service_role, postgres, supabase_auth_admin;

-- Rebind administrator 2FA mutations to the same authoritative database
-- grant/state predicate. These functions are created by the preceding 2FA
-- migrations; replace their duplicated profile-only role checks after the
-- canonical helper is available.
DO $admin_2fa_canonical_actor$
DECLARE
    v_name TEXT;
    v_oid OID;
    v_definition TEXT;
    v_updated TEXT;
    v_pattern CONSTANT TEXT := $re$IF NOT \(COALESCE\(v_profile[.]is_admin, false\)\s+OR COALESCE\(v_profile[.]is_admin_account, false\)\s+OR LOWER\(COALESCE\(v_profile[.]role::TEXT, ''\)\) = 'admin'\) THEN\s+RAISE EXCEPTION 'Administrator privileges required[.]' USING ERRCODE = '42501';\s+END IF;$re$;
    v_replacement CONSTANT TEXT := $replacement$IF NOT public.check_is_admin(p_admin_id, NULL) THEN
    RAISE EXCEPTION 'Administrator privileges required.' USING ERRCODE = '42501';
  END IF;$replacement$;
BEGIN
    FOREACH v_name IN ARRAY ARRAY[
        'enable_admin_2fa_atomic',
        'disable_admin_2fa_atomic',
        'recover_admin_2fa_atomic',
        'rotate_admin_2fa_recovery_atomic'
    ] LOOP
        SELECT p.oid
          INTO v_oid
          FROM pg_proc AS p
          JOIN pg_namespace AS n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = v_name
           AND p.prosecdef;

        IF v_oid IS NULL THEN
            RAISE EXCEPTION 'Required admin 2FA RPC % is missing.', v_name;
        END IF;

        v_definition := pg_get_functiondef(v_oid);
        IF position('public.check_is_admin(p_admin_id, NULL)' IN v_definition) > 0 THEN
            CONTINUE;
        END IF;

        IF regexp_count(v_definition, v_pattern, 1, 'is') <> 1 THEN
            RAISE EXCEPTION
                'Admin 2FA RPC % does not match the expected identity guard; refusing an unsafe rewrite.',
                v_name;
        END IF;

        v_updated := regexp_replace(v_definition, v_pattern, v_replacement, 1, 1, 'is');
        IF v_updated = v_definition
           OR position('public.check_is_admin(p_admin_id, NULL)' IN v_updated) = 0 THEN
            RAISE EXCEPTION 'Failed to install canonical admin check in 2FA RPC %.', v_name;
        END IF;

        EXECUTE v_updated;
    END LOOP;
END;
$admin_2fa_canonical_actor$;

-- New server-only atomic role mutation. It verifies the actor from the canonical
-- Auth account and active admin registry, then commits profile, app_admins, and
-- mandatory audit changes in one PostgreSQL transaction.
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

    IF NOT public.check_is_admin(p_admin_id, NULL) THEN
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

    PERFORM 1
      FROM public.profiles AS p
     WHERE p.id = p_target_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target user not found.'
            USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.profiles
       SET role = v_new_role::public.user_role,
           is_admin = (v_new_role = 'admin'),
           is_admin_account = (v_new_role = 'admin'),
           updated_at = NOW()
     WHERE id = p_target_user_id;

    IF v_new_role = 'admin' THEN
        INSERT INTO public.app_admins (user_id, role, granted_at, created_at)
        VALUES (p_target_user_id, 'admin', NOW(), NOW())
        ON CONFLICT (user_id) DO UPDATE
            SET role = 'admin',
                granted_at = NOW(),
                created_at = COALESCE(public.app_admins.created_at, NOW());
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

ALTER FUNCTION public.admin_update_user_role_authorized(UUID, TEXT, UUID, TEXT)
    OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_update_user_role_authorized(UUID, TEXT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role_authorized(UUID, TEXT, UUID, TEXT)
    TO service_role, postgres;

-- New server-only atomic account-status mutation. Restricted is represented
-- separately from suspended and banned; status flags, account_status, ad state,
-- and mandatory audit data move together or the whole transaction rolls back.
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

    IF NOT public.check_is_admin(p_admin_id, NULL) THEN
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

    PERFORM 1
      FROM public.profiles AS p
     WHERE p.id = p_target_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target user not found.'
            USING ERRCODE = 'P0002';
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
               WHEN p_status = 'banned'::public.user_status_enum THEN NOW()
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
           SET is_active = FALSE
         WHERE user_id = p_target_user_id;
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

ALTER FUNCTION public.admin_update_user_status_authorized(
    UUID, TEXT, UUID, public.user_status_enum, TEXT, public.ban_withdrawal_policy_enum
) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_update_user_status_authorized(
    UUID, TEXT, UUID, public.user_status_enum, TEXT, public.ban_withdrawal_policy_enum
) FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.admin_update_user_status_authorized(
    UUID, TEXT, UUID, public.user_status_enum, TEXT, public.ban_withdrawal_policy_enum
) TO service_role, postgres;

-- Retire old API-callable administrative mutations. Current application routes
-- use the authorized wrappers above or the purpose-built emergency-mode/freeze
-- wrappers from the same migration release. Old privileged implementations stay
-- executable only by the database owner for explicit maintenance/recovery.
REVOKE ALL ON FUNCTION public.admin_update_user_role(UUID, UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role(UUID, UUID, TEXT)
    TO postgres;

REVOKE ALL ON FUNCTION public.admin_update_user_status(
    TEXT, UUID, public.user_status_enum, TEXT, public.ban_withdrawal_policy_enum
) FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.admin_update_user_status(
    TEXT, UUID, public.user_status_enum, TEXT, public.ban_withdrawal_policy_enum
) TO postgres;

-- Direct authenticated access to these emergency actions bypassed the complete
-- verifyServerAdmin/2FA gate. New *_authorized wrappers are server-only.
REVOKE ALL ON FUNCTION public.admin_freeze_user(UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.admin_freeze_user(UUID, TEXT)
    TO postgres;

REVOKE ALL ON FUNCTION public.admin_unfreeze_user(UUID, TEXT)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.admin_unfreeze_user(UUID, TEXT)
    TO postgres;

REVOKE ALL ON FUNCTION public.admin_set_emergency_mode(BOOLEAN, TEXT)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.admin_set_emergency_mode(BOOLEAN, TEXT)
    TO postgres;

-- Service-role wrappers are created here because these function signatures
-- were absent from the production schema. A service key authenticates the
-- backend process, never the human administrator actor supplied by that process.
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
DECLARE
    v_actor_email TEXT;
    v_supplied_email TEXT := NULLIF(BTRIM(p_actor_email), '');
    v_clean_reason TEXT := NULLIF(BTRIM(p_reason), '');
    v_previous_value JSONB;
BEGIN
    IF COALESCE(auth.role(), '') <> 'service_role' THEN
        RAISE EXCEPTION 'Trusted server execution required.' USING ERRCODE = '42501';
    END IF;
    IF p_actor_id IS NULL OR p_enabled IS NULL THEN
        RAISE EXCEPTION 'Actor and emergency state are required.' USING ERRCODE = '22023';
    END IF;
    IF NOT public.check_is_admin(p_actor_id, NULL) THEN
        RAISE EXCEPTION 'A full, active administrator grant is required.' USING ERRCODE = '42501';
    END IF;

    SELECT NULLIF(BTRIM(u.email), '')
      INTO v_actor_email
      FROM auth.users AS u
     WHERE u.id = p_actor_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Administrator Auth account was not found.' USING ERRCODE = '42501';
    END IF;
    IF v_actor_email IS NOT NULL AND v_supplied_email IS NOT NULL
       AND LOWER(v_actor_email) <> LOWER(v_supplied_email) THEN
        RAISE EXCEPTION 'Administrator email does not match canonical Auth email.' USING ERRCODE = '42501';
    END IF;

    IF p_enabled AND (v_clean_reason IS NULL OR LENGTH(v_clean_reason) < 3 OR LENGTH(v_clean_reason) > 1000) THEN
        RAISE EXCEPTION 'A reason between 3 and 1000 characters is required.' USING ERRCODE = '22023';
    END IF;

    SELECT value INTO v_previous_value
      FROM public.system_settings
     WHERE key = 'emergency_mode'
     FOR UPDATE;

    INSERT INTO public.system_settings (key, value, updated_at)
    VALUES ('emergency_mode', TO_JSONB(p_enabled), NOW())
    ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = NOW();

    INSERT INTO public.admin_audit_logs
        (admin_id, admin_email, action, target_id, details, created_at)
    VALUES (
        p_actor_id, v_actor_email,
        CASE WHEN p_enabled THEN 'EMERGENCY_MODE_ENABLED' ELSE 'EMERGENCY_MODE_DISABLED' END,
        'emergency_mode',
        JSONB_BUILD_OBJECT(
            'previous_value', v_previous_value,
            'new_value', p_enabled,
            'reason', COALESCE(v_clean_reason, 'Manual administrator update'),
            'updated_at', NOW()
        ),
        NOW()
    );

    RETURN JSONB_BUILD_OBJECT('success', TRUE, 'emergency_mode', p_enabled, 'updated_at', NOW());
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
    IF NOT public.check_is_admin(p_actor_id, NULL) THEN
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
       SET is_emergency_frozen = TRUE,
           emergency_frozen_at = NOW(),
           emergency_frozen_by = p_actor_id,
           emergency_freeze_reason = v_reason,
           updated_at = NOW()
     WHERE id = p_target_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target user not found.' USING ERRCODE = 'P0002';
    END IF;

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
    IF p_actor_id IS NULL OR p_target_user_id IS NULL THEN
        RAISE EXCEPTION 'Target and administrator actor are required.' USING ERRCODE = '22023';
    END IF;
    IF LENGTH(v_reason) > 1000 THEN
        RAISE EXCEPTION 'Reason must be 1000 characters or fewer.' USING ERRCODE = '22023';
    END IF;
    IF NOT public.check_is_admin(p_actor_id, NULL) THEN
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
       SET is_emergency_frozen = FALSE,
           emergency_frozen_at = NULL,
           emergency_frozen_by = NULL,
           emergency_freeze_reason = NULL,
           updated_at = NOW()
     WHERE id = p_target_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target user not found.' USING ERRCODE = 'P0002';
    END IF;

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

ALTER FUNCTION public.admin_set_emergency_mode_authorized(BOOLEAN, TEXT, UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.admin_freeze_user_authorized(UUID, TEXT, UUID, TEXT) OWNER TO postgres;
ALTER FUNCTION public.admin_unfreeze_user_authorized(UUID, TEXT, UUID, TEXT) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.admin_set_emergency_mode_authorized(BOOLEAN, TEXT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.admin_freeze_user_authorized(UUID, TEXT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
REVOKE ALL ON FUNCTION public.admin_unfreeze_user_authorized(UUID, TEXT, UUID, TEXT)
    FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.admin_set_emergency_mode_authorized(BOOLEAN, TEXT, UUID, TEXT)
    TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.admin_freeze_user_authorized(UUID, TEXT, UUID, TEXT)
    TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.admin_unfreeze_user_authorized(UUID, TEXT, UUID, TEXT)
    TO service_role, postgres;

-- Retire the unused legacy wallet-draining final-withdrawal RPC. It is not used
-- by current app source, operates on legacy wallets/admin_main_wallets tables,
-- and predates the current withdrawal kill-switch/idempotency/worker contract.
-- Keep only database-owner recovery access; user withdrawals stay disabled until
-- the canonical fenced settlement pipeline is fully reconciled and released.
REVOKE ALL ON FUNCTION public.execute_final_withdrawal(UUID, TEXT, TEXT, TEXT, NUMERIC)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.execute_final_withdrawal(UUID, TEXT, TEXT, TEXT, NUMERIC)
    TO postgres;

-- Bulk status operations are invoked by server-only code through the service
-- role. Verify the supplied actor against the canonical Auth/admin registry on
-- that server path, then remove direct authenticated/public EXECUTE grants.
DO $bulk_admin_hardening$
DECLARE
    v_signature TEXT;
    v_oid OID;
    v_definition TEXT;
    v_replacement TEXT;
    v_pattern TEXT := 'IF auth[.]role[(][)] = ''service_role'' OR current_setting[(]''role'', true[)] = ''service_role'' THEN[[:space:]]+v_is_authorized := TRUE;[[:space:]]+v_authoritative_admin_id := p_admin_id;[[:space:]]+v_authoritative_admin_email := COALESCE[(]p_admin_email, ''service_role@paxones[.]internal''[)];';
    v_name TEXT;
    v_expected INTEGER;
BEGIN
    FOREACH v_name IN ARRAY ARRAY[
        'execute_bulk_ban_atomic',
        'execute_bulk_restrict_atomic',
        'execute_bulk_unban_atomic',
        'execute_bulk_unrestrict_atomic'
    ] LOOP
        SELECT p.oid
          INTO v_oid
          FROM pg_proc AS p
          JOIN pg_namespace AS n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public'
           AND p.proname = v_name
           AND pg_get_function_identity_arguments(p.oid) IN (
               'p_admin_id uuid, p_admin_email text, p_reason text',
               'p_admin_id uuid, p_admin_email text'
           );

        IF v_oid IS NULL THEN
            RAISE EXCEPTION 'Required bulk admin RPC % is missing or has an unexpected signature.', v_name;
        END IF;

        v_definition := pg_get_functiondef(v_oid);
        v_expected := regexp_count(v_definition, v_pattern, 1, 'i');
        IF v_expected <> 1 THEN
            RAISE EXCEPTION 'Bulk admin RPC % expected one service-role actor block, found %.', v_name, v_expected;
        END IF;

        v_replacement := $replacement$IF auth.role() = 'service_role' OR current_setting('role', true) = 'service_role' THEN
            v_authoritative_admin_id := p_admin_id;
            IF v_authoritative_admin_id IS NULL
               OR NOT public.check_is_admin(v_authoritative_admin_id, NULL) THEN
                RAISE EXCEPTION 'A full, active administrator grant is required for bulk status operations.'
                    USING ERRCODE = '42501';
            END IF;

            SELECT NULLIF(BTRIM(u.email), '')
              INTO v_authoritative_admin_email
              FROM auth.users AS u
             WHERE u.id = v_authoritative_admin_id;

            IF NOT FOUND THEN
                RAISE EXCEPTION 'Administrator Auth account was not found.'
                    USING ERRCODE = '42501';
            END IF;

            IF NULLIF(BTRIM(p_admin_email), '') IS NOT NULL
               AND v_authoritative_admin_email IS NOT NULL
               AND LOWER(v_authoritative_admin_email) <> LOWER(BTRIM(p_admin_email)) THEN
                RAISE EXCEPTION 'Administrator email does not match the canonical Auth email.'
                    USING ERRCODE = '42501';
            END IF;

            v_is_authorized := TRUE;$replacement$;

        EXECUTE regexp_replace(v_definition, v_pattern, v_replacement, 1, 1, 'i');

        v_signature := format(
            'public.%I(%s)',
            v_name,
            pg_get_function_identity_arguments(v_oid)
        );
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, supabase_auth_admin', v_signature);
        EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role, postgres', v_signature);
    END LOOP;
END;
$bulk_admin_hardening$;

COMMIT;
