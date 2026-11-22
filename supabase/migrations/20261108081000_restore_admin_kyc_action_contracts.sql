-- Restore full-admin KYC lifecycle actions with canonical actor checks and
-- mandatory same-transaction audit. Never write a non-existent is_id_verified
-- compatibility column; deployed profile state is is_verified + id_verified.
BEGIN;

DO $admin_kyc_dependencies$
BEGIN
  IF to_regprocedure('public.is_active_full_admin_actor(uuid)') IS NULL
     OR to_regclass('public.profiles') IS NULL
     OR to_regclass('public.admin_audit_logs') IS NULL
     OR to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'Full-admin, profile, Auth or audit dependencies are missing.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name='kyc_status' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name='is_verified' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name='id_verified' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name='verification_tier' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name='is_kyc_locked' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name='kyc_vendor_session_id' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name='didit_session_id' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name='kyc_attempts' AND data_type='integer'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name='kyc_retry_count' AND data_type='integer'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name='kyc_retry_after' AND data_type='timestamp with time zone'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name='is_withdrawal_locked' AND data_type='boolean'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='profiles'
      AND column_name='withdrawals_disabled' AND data_type='boolean'
  ) THEN
    RAISE EXCEPTION 'Deployed KYC profile column contract does not match this migration.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='admin_audit_logs'
      AND column_name='admin_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='admin_audit_logs'
      AND column_name='admin_email' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='admin_audit_logs'
      AND column_name='target_user_id' AND data_type='uuid'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='admin_audit_logs'
      AND column_name='details' AND data_type='jsonb'
  ) THEN
    RAISE EXCEPTION 'Mandatory administrator audit schema is incomplete.';
  END IF;
END;
$admin_kyc_dependencies$;

CREATE OR REPLACE FUNCTION public.admin_update_user_kyc_authorized(
    p_admin_id uuid,
    p_admin_email text,
    p_target_user_id uuid,
    p_action text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_actor_email text;
    v_supplied_email text := nullif(pg_catalog.btrim(p_admin_email), '');
    v_action text := pg_catalog.lower(pg_catalog.btrim(coalesce(p_action, '')));
    v_target public.profiles%ROWTYPE;
    v_previous_status text;
    v_previous_verified boolean;
    v_previous_id_verified boolean;
    v_previous_tier text;
    v_new_status text;
    v_new_tier text;
BEGIN
    IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'Trusted server execution required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_admin_id IS NULL OR p_target_user_id IS NULL THEN
        RAISE EXCEPTION 'Administrator and target user are required.'
            USING ERRCODE = '22023';
    END IF;

    IF p_admin_id = p_target_user_id THEN
        RAISE EXCEPTION 'Administrators cannot change their own KYC status through this operation.'
            USING ERRCODE = '42501';
    END IF;

    IF v_action NOT IN ('reset_kyc', 'verify_kyc', 'unverify_kyc') THEN
        RAISE EXCEPTION 'Unsupported KYC lifecycle action.'
            USING ERRCODE = '22023';
    END IF;

    IF NOT public.is_active_full_admin_actor(p_admin_id) THEN
        RAISE EXCEPTION 'A full, active administrator grant is required.'
            USING ERRCODE = '42501';
    END IF;

    SELECT nullif(pg_catalog.btrim(u.email), '')
      INTO v_actor_email
      FROM auth.users AS u
     WHERE u.id = p_admin_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Administrator Auth account was not found.'
            USING ERRCODE = '42501';
    END IF;

    IF v_actor_email IS NULL
       OR v_supplied_email IS NULL
       OR pg_catalog.lower(v_actor_email) <> pg_catalog.lower(v_supplied_email) THEN
        RAISE EXCEPTION 'A matching canonical administrator Auth email is required.'
            USING ERRCODE = '42501';
    END IF;

    SELECT p.*
      INTO v_target
      FROM public.profiles AS p
     WHERE p.id = p_target_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target user not found.'
            USING ERRCODE = 'P0002';
    END IF;

    v_previous_status := v_target.kyc_status;
    v_previous_verified := COALESCE(v_target.is_verified, false);
    v_previous_id_verified := COALESCE(v_target.id_verified, false);
    v_previous_tier := v_target.verification_tier;

    IF v_action = 'reset_kyc' THEN
        UPDATE public.profiles
           SET kyc_status = 'NOT_SUBMITTED',
               is_verified = false,
               id_verified = false,
               kyc_attempts = 0,
               kyc_retry_count = 0,
               verification_tier = '1',
               didit_session_id = NULL,
               kyc_vendor_session_id = NULL,
               kyc_retry_after = NULL,
               kyc_submitted_at = NULL,
               kyc_approved_at = NULL,
               kyc_last_attempt_at = NULL,
               is_kyc_locked = false,
               updated_at = pg_catalog.clock_timestamp()
         WHERE id = p_target_user_id;
        v_new_status := 'NOT_SUBMITTED';
        v_new_tier := '1';
    ELSIF v_action = 'verify_kyc' THEN
        UPDATE public.profiles
           SET kyc_status = 'approved',
               is_verified = true,
               id_verified = true,
               verification_tier = '2',
               -- Verified users must remain eligible to withdraw. The existing
               -- KYC lock blocks withdrawal after repeated failed attempts.
               is_kyc_locked = false,
               kyc_attempts = 0,
               kyc_retry_count = 0,
               kyc_approved_at = pg_catalog.clock_timestamp(),
               kyc_retry_after = NULL,
               updated_at = pg_catalog.clock_timestamp()
         WHERE id = p_target_user_id;
        v_new_status := 'approved';
        v_new_tier := '2';
    ELSE
        UPDATE public.profiles
           SET kyc_status = 'UNVERIFIED',
               is_verified = false,
               id_verified = false,
               verification_tier = '1',
               is_kyc_locked = false,
               kyc_approved_at = NULL,
               kyc_retry_after = NULL,
               updated_at = pg_catalog.clock_timestamp()
         WHERE id = p_target_user_id;
        v_new_status := 'UNVERIFIED';
        v_new_tier := '1';
    END IF;

    INSERT INTO public.admin_audit_logs (
        admin_id,
        admin_email,
        action,
        target_id,
        target_user_id,
        details,
        created_at
    ) VALUES (
        p_admin_id,
        v_actor_email,
        CASE v_action
          WHEN 'reset_kyc' THEN 'RESET_USER_KYC'
          WHEN 'verify_kyc' THEN 'FORCE_VERIFY_KYC'
          ELSE 'FORCE_UNVERIFY_KYC'
        END,
        p_target_user_id::text,
        p_target_user_id,
        pg_catalog.jsonb_build_object(
            'operation', v_action,
            'previous', pg_catalog.jsonb_build_object(
                'kyc_status', v_previous_status,
                'is_verified', v_previous_verified,
                'id_verified', v_previous_id_verified,
                'verification_tier', v_previous_tier
            ),
            'current', pg_catalog.jsonb_build_object(
                'kyc_status', v_new_status,
                'is_verified', v_action = 'verify_kyc',
                'id_verified', v_action = 'verify_kyc',
                'verification_tier', v_new_tier
            ),
            'actor_id', p_admin_id,
            'changed_at', pg_catalog.clock_timestamp()
        ),
        pg_catalog.clock_timestamp()
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'target_user_id', p_target_user_id,
        'action', v_action,
        'kyc_status', v_new_status,
        'verification_tier', v_new_tier,
        'audit_logged', true,
        'actor_id', p_admin_id
    );
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_user_withdrawal_lock_authorized(
    p_admin_id uuid,
    p_admin_email text,
    p_target_user_id uuid,
    p_locked boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
    v_actor_email text;
    v_supplied_email text := nullif(pg_catalog.btrim(p_admin_email), '');
    v_previous_locked boolean;
    v_previous_disabled boolean;
BEGIN
    IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
        RAISE EXCEPTION 'Trusted server execution required.'
            USING ERRCODE = '42501';
    END IF;

    IF p_admin_id IS NULL OR p_target_user_id IS NULL OR p_locked IS NULL THEN
        RAISE EXCEPTION 'Administrator, target user and lock state are required.'
            USING ERRCODE = '22023';
    END IF;

    IF p_admin_id = p_target_user_id THEN
        RAISE EXCEPTION 'Administrators cannot change their own withdrawal lock through this operation.'
            USING ERRCODE = '42501';
    END IF;

    IF NOT public.is_active_full_admin_actor(p_admin_id) THEN
        RAISE EXCEPTION 'A full, active administrator grant is required.'
            USING ERRCODE = '42501';
    END IF;

    SELECT nullif(pg_catalog.btrim(u.email), '')
      INTO v_actor_email
      FROM auth.users AS u
     WHERE u.id = p_admin_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Administrator Auth account was not found.'
            USING ERRCODE = '42501';
    END IF;

    IF v_actor_email IS NULL
       OR v_supplied_email IS NULL
       OR pg_catalog.lower(v_actor_email) <> pg_catalog.lower(v_supplied_email) THEN
        RAISE EXCEPTION 'A matching canonical administrator Auth email is required.'
            USING ERRCODE = '42501';
    END IF;

    SELECT
      COALESCE(p.is_withdrawal_locked, false),
      COALESCE(p.withdrawals_disabled, false)
      INTO v_previous_locked, v_previous_disabled
      FROM public.profiles AS p
     WHERE p.id = p_target_user_id
     FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target user not found.'
            USING ERRCODE = 'P0002';
    END IF;

    UPDATE public.profiles
       SET is_withdrawal_locked = p_locked,
           withdrawals_disabled = p_locked,
           updated_at = pg_catalog.clock_timestamp()
     WHERE id = p_target_user_id;

    INSERT INTO public.admin_audit_logs (
        admin_id,
        admin_email,
        action,
        target_id,
        target_user_id,
        details,
        created_at
    ) VALUES (
        p_admin_id,
        v_actor_email,
        CASE WHEN p_locked THEN 'LOCK_USER_WITHDRAWAL' ELSE 'UNLOCK_USER_WITHDRAWAL' END,
        p_target_user_id::text,
        p_target_user_id,
        pg_catalog.jsonb_build_object(
            'previous_is_withdrawal_locked', v_previous_locked,
            'previous_withdrawals_disabled', v_previous_disabled,
            'locked', p_locked,
            'actor_id', p_admin_id,
            'changed_at', pg_catalog.clock_timestamp()
        ),
        pg_catalog.clock_timestamp()
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', true,
        'target_user_id', p_target_user_id,
        'locked', p_locked,
        'audit_logged', true,
        'actor_id', p_admin_id
    );
END;
$function$;

ALTER FUNCTION public.admin_set_user_withdrawal_lock_authorized(uuid,text,uuid,boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_set_user_withdrawal_lock_authorized(uuid,text,uuid,boolean)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.admin_set_user_withdrawal_lock_authorized(uuid,text,uuid,boolean)
    TO service_role, postgres;

COMMENT ON FUNCTION public.admin_set_user_withdrawal_lock_authorized(uuid,text,uuid,boolean) IS
  'Full-admin withdrawal lock wrapper. Verifies canonical active full-admin identity, locks the target profile, updates both withdrawal lock flags and writes the mandatory audit atomically.';

ALTER FUNCTION public.admin_update_user_kyc_authorized(uuid,text,uuid,text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.admin_update_user_kyc_authorized(uuid,text,uuid,text)
    FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.admin_update_user_kyc_authorized(uuid,text,uuid,text)
    TO service_role, postgres;

COMMENT ON FUNCTION public.admin_update_user_kyc_authorized(uuid,text,uuid,text) IS
  'Full-admin KYC reset/verify/unverify wrapper. Requires a trusted service-role request, confirms canonical active full-admin identity and email, locks the target profile, updates only deployed KYC columns, and writes a mandatory audit in the same transaction.';

NOTIFY pgrst, 'reload schema';
COMMIT;
