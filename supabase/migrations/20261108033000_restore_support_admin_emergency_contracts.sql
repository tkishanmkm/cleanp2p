-- Forward restoration of the restricted support-admin emergency-mode database contract.
-- Grants, emergency sessions and mandatory access audit are committed atomically.
BEGIN;

CREATE TABLE IF NOT EXISTS public.support_admin_grants (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  is_enabled boolean NOT NULL DEFAULT true,
  emergency_uses_granted integer NOT NULL DEFAULT 0 CHECK (emergency_uses_granted >= 0),
  emergency_uses_consumed integer NOT NULL DEFAULT 0 CHECK (emergency_uses_consumed >= 0),
  emergency_uses_remaining integer NOT NULL DEFAULT 0 CHECK (emergency_uses_remaining >= 0),
  granted_by_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_admin_use_accounting_check
    CHECK (emergency_uses_granted = emergency_uses_consumed + emergency_uses_remaining)
);

CREATE TABLE IF NOT EXISTS public.support_admin_emergency_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  support_admin_id uuid NOT NULL REFERENCES public.support_admin_grants(user_id) ON DELETE CASCADE,
  activated_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  two_factor_verified_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_by_admin_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  revoke_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT support_admin_emergency_session_window_check
    CHECK (expires_at > activated_at AND expires_at <= activated_at + interval '3 hours')
);

CREATE UNIQUE INDEX IF NOT EXISTS support_admin_one_unrevoked_emergency_session
  ON public.support_admin_emergency_sessions (support_admin_id)
  WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS support_admin_emergency_sessions_expiry_idx
  ON public.support_admin_emergency_sessions (support_admin_id, expires_at DESC);

CREATE TABLE IF NOT EXISTS public.support_admin_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  support_admin_id uuid NOT NULL REFERENCES public.support_admin_grants(user_id) ON DELETE RESTRICT,
  emergency_session_id uuid REFERENCES public.support_admin_emergency_sessions(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text,
  target_id text,
  outcome text NOT NULL DEFAULT 'attempted'
    CHECK (outcome IN ('attempted', 'succeeded', 'failed', 'denied')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_admin_activity_created_idx
  ON public.support_admin_activity (created_at DESC);
CREATE INDEX IF NOT EXISTS support_admin_activity_actor_idx
  ON public.support_admin_activity (support_admin_id, created_at DESC);

ALTER TABLE public.support_admin_grants OWNER TO postgres;
ALTER TABLE public.support_admin_emergency_sessions OWNER TO postgres;
ALTER TABLE public.support_admin_activity OWNER TO postgres;
ALTER TABLE public.support_admin_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_admin_emergency_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_admin_activity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.support_admin_grants FROM PUBLIC, anon, authenticated, supabase_auth_admin;
REVOKE ALL ON TABLE public.support_admin_emergency_sessions FROM PUBLIC, anon, authenticated, supabase_auth_admin;
REVOKE ALL ON TABLE public.support_admin_activity FROM PUBLIC, anon, authenticated, supabase_auth_admin;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.support_admin_grants TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.support_admin_emergency_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.support_admin_activity TO service_role;

CREATE OR REPLACE FUNCTION public.is_active_full_admin_actor(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p_user_id IS NOT NULL
     AND EXISTS (
       SELECT 1
       FROM public.verify_admin_login(p_user_id, NULL) AS verified
       JOIN public.profiles AS p ON p.id = p_user_id
       WHERE verified.is_valid IS TRUE
         AND COALESCE(verified.suspended_val, false) IS FALSE
         AND LOWER(COALESCE(p.status::text, '')) = 'active'
         AND (p.account_status IS NULL OR LOWER(p.account_status) = 'active')
         AND COALESCE(p.is_banned, false) = false
         AND COALESCE(p.is_suspended, false) = false
         AND COALESCE(p.is_restricted, false) = false
         AND COALESCE(p.is_on_hold, false) = false
         AND COALESCE(p.is_emergency_frozen, false) = false
         AND COALESCE(p.is_minor_restricted, false) = false
     );
$function$;
ALTER FUNCTION public.is_active_full_admin_actor(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.is_active_full_admin_actor(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_full_admin_actor(uuid) TO postgres;

CREATE OR REPLACE FUNCTION public.configure_support_admin(
  p_user_id uuid,
  p_admin_id uuid,
  p_enable boolean,
  p_add_emergency_uses integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_profile public.profiles%ROWTYPE;
  v_admin_email text;
  v_now timestamptz := clock_timestamp();
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Trusted backend required.' USING ERRCODE = '42501';
  END IF;
  IF p_user_id IS NULL OR p_admin_id IS NULL OR p_enable IS NULL
     OR p_add_emergency_uses IS NULL
     OR p_add_emergency_uses < 0 OR p_add_emergency_uses > 1000 THEN
    RAISE EXCEPTION 'Invalid support-admin configuration.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_active_full_admin_actor(p_admin_id) THEN
    RAISE EXCEPTION 'An active full administrator is required to configure support access.' USING ERRCODE = '42501';
  END IF;

  SELECT p.* INTO v_profile
    FROM public.profiles AS p
   WHERE p.id = p_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Support-admin profile not found.' USING ERRCODE = 'P0002';
  END IF;
  IF LOWER(COALESCE(v_profile.status::text, '')) <> 'active'
     OR (v_profile.account_status IS NOT NULL AND LOWER(v_profile.account_status) <> 'active')
     OR COALESCE(v_profile.is_banned, false)
     OR COALESCE(v_profile.is_suspended, false)
     OR COALESCE(v_profile.is_restricted, false)
     OR COALESCE(v_profile.is_on_hold, false)
     OR COALESCE(v_profile.is_emergency_frozen, false)
     OR COALESCE(v_profile.is_minor_restricted, false) THEN
    RAISE EXCEPTION 'Only an active, unrestricted account can receive support-admin access.' USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_profile.role::text, '') = 'admin'
     OR COALESCE(v_profile.is_admin, false)
     OR COALESCE(v_profile.is_admin_account, false)
     OR EXISTS (SELECT 1 FROM public.app_admins AS aa WHERE aa.user_id = p_user_id)
     OR EXISTS (
       SELECT 1 FROM public.verify_admin_login(p_user_id, NULL) AS verified
       WHERE verified.is_valid IS TRUE
     ) THEN
    RAISE EXCEPTION 'A full administrator cannot be configured as a support admin.' USING ERRCODE = '22023';
  END IF;

  -- Disabling a grant immediately invalidates every still-unrevoked session.
  -- Re-enabling later therefore cannot resurrect a previously verified session.
  IF NOT p_enable THEN
    UPDATE public.support_admin_emergency_sessions
       SET revoked_at = v_now,
           revoked_by_admin_id = p_admin_id,
           revoke_reason = 'Support-admin access disabled by administrator'
     WHERE support_admin_id = p_user_id
       AND revoked_at IS NULL;
  END IF;

  INSERT INTO public.support_admin_grants AS current_grant (
    user_id, is_enabled, emergency_uses_granted, emergency_uses_consumed,
    emergency_uses_remaining, granted_by_admin_id, created_at, updated_at
  ) VALUES (
    p_user_id, p_enable, p_add_emergency_uses, 0,
    p_add_emergency_uses, p_admin_id, v_now, v_now
  )
  ON CONFLICT (user_id) DO UPDATE SET
    is_enabled = EXCLUDED.is_enabled,
    emergency_uses_granted = current_grant.emergency_uses_granted + EXCLUDED.emergency_uses_granted,
    emergency_uses_remaining = current_grant.emergency_uses_remaining + EXCLUDED.emergency_uses_remaining,
    granted_by_admin_id = EXCLUDED.granted_by_admin_id,
    updated_at = v_now;

  SELECT COALESCE(u.email, 'admin') INTO v_admin_email
    FROM auth.users AS u
   WHERE u.id = p_admin_id;
  v_admin_email := COALESCE(v_admin_email, 'admin');

  -- Persist the authorization change and its human-actor audit in one transaction.
  INSERT INTO public.admin_audit_logs
    (admin_id, admin_email, action, target_id, target_user_id, details, created_at)
  VALUES (
    p_admin_id, v_admin_email, 'CONFIGURE_SUPPORT_ADMIN', p_user_id::text, p_user_id,
    jsonb_build_object(
      'enabled', p_enable,
      'emergency_uses_added', p_add_emergency_uses,
      'active_sessions_revoked', NOT p_enable
    ),
    v_now
  );

  RETURN jsonb_build_object('success', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.activate_support_admin_emergency(
  p_support_admin_id uuid,
  p_two_factor_verified_at timestamptz
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_grant public.support_admin_grants%ROWTYPE;
  v_profile public.profiles%ROWTYPE;
  v_two_factor_enabled boolean := false;
  v_session_id uuid;
  v_activated_at timestamptz := clock_timestamp();
  v_expires_at timestamptz;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Trusted backend required.' USING ERRCODE = '42501';
  END IF;
  IF p_support_admin_id IS NULL OR p_two_factor_verified_at IS NULL
     OR p_two_factor_verified_at < v_activated_at - interval '90 seconds'
     OR p_two_factor_verified_at > v_activated_at + interval '10 seconds' THEN
    RAISE EXCEPTION 'A recent verified two-factor challenge is required.' USING ERRCODE = '22023';
  END IF;

  -- Use the same profile -> grant lock order as configure_support_admin.
  SELECT p.* INTO v_profile
    FROM public.profiles AS p
   WHERE p.id = p_support_admin_id
   FOR UPDATE;
  IF NOT FOUND
     OR LOWER(COALESCE(v_profile.status::text, '')) <> 'active'
     OR (v_profile.account_status IS NOT NULL AND LOWER(v_profile.account_status) <> 'active')
     OR COALESCE(v_profile.is_banned, false)
     OR COALESCE(v_profile.is_suspended, false)
     OR COALESCE(v_profile.is_restricted, false)
     OR COALESCE(v_profile.is_on_hold, false)
     OR COALESCE(v_profile.is_emergency_frozen, false)
     OR COALESCE(v_profile.is_minor_restricted, false) THEN
    RAISE EXCEPTION 'Support-admin account is not active and eligible for emergency access.' USING ERRCODE = '42501';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.verify_admin_login(p_support_admin_id, NULL) AS verified
    WHERE verified.is_valid IS TRUE
  ) OR COALESCE(v_profile.role::text, '') = 'admin'
     OR COALESCE(v_profile.is_admin, false)
     OR COALESCE(v_profile.is_admin_account, false)
     OR EXISTS (SELECT 1 FROM public.app_admins AS aa WHERE aa.user_id = p_support_admin_id) THEN
    RAISE EXCEPTION 'Full administrators cannot activate a support-admin emergency session.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_grant
    FROM public.support_admin_grants
   WHERE user_id = p_support_admin_id
   FOR UPDATE;
  IF NOT FOUND OR NOT v_grant.is_enabled THEN
    RAISE EXCEPTION 'Support-admin access is not enabled.' USING ERRCODE = '42501';
  END IF;
  IF v_grant.emergency_uses_granted <>
     v_grant.emergency_uses_consumed + v_grant.emergency_uses_remaining THEN
    RAISE EXCEPTION 'Support-admin emergency-use accounting is inconsistent.' USING ERRCODE = '23514';
  END IF;
  IF v_grant.emergency_uses_remaining < 1 THEN
    RAISE EXCEPTION 'No emergency-mode uses remain.' USING ERRCODE = 'P0001';
  END IF;

  v_two_factor_enabled :=
    COALESCE(v_profile.admin_2fa_enabled, false)
    OR COALESCE(v_profile.is_2fa_enabled, false)
    OR COALESCE(v_profile.is_mfa_enabled, false)
    OR COALESCE(v_profile.two_factor_enabled, false);
  IF NOT v_two_factor_enabled THEN
    RAISE EXCEPTION 'Support admin must enable two-factor authentication first.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.support_admin_emergency_sessions
     SET revoked_at = v_activated_at,
         revoke_reason = 'Expired automatically'
   WHERE support_admin_id = p_support_admin_id
     AND revoked_at IS NULL
     AND expires_at <= v_activated_at;

  IF EXISTS (
    SELECT 1 FROM public.support_admin_emergency_sessions AS s
     WHERE s.support_admin_id = p_support_admin_id
       AND s.revoked_at IS NULL
       AND s.expires_at > v_activated_at
  ) THEN
    RAISE EXCEPTION 'Emergency mode is already active.' USING ERRCODE = 'P0001';
  END IF;

  v_expires_at := v_activated_at + interval '3 hours';
  UPDATE public.support_admin_grants
     SET emergency_uses_remaining = emergency_uses_remaining - 1,
         emergency_uses_consumed = emergency_uses_consumed + 1,
         updated_at = v_activated_at
   WHERE user_id = p_support_admin_id;

  INSERT INTO public.support_admin_emergency_sessions (
    support_admin_id, activated_at, expires_at, two_factor_verified_at
  ) VALUES (
    p_support_admin_id, v_activated_at, v_expires_at, p_two_factor_verified_at
  ) RETURNING id INTO v_session_id;

  INSERT INTO public.support_admin_activity (
    support_admin_id, emergency_session_id, action, outcome, details, created_at
  ) VALUES (
    p_support_admin_id, v_session_id, 'EMERGENCY_MODE_ACTIVATED', 'succeeded',
    jsonb_build_object('expires_at', v_expires_at, 'uses_remaining', v_grant.emergency_uses_remaining - 1),
    v_activated_at
  );

  RETURN jsonb_build_object(
    'success', true,
    'session_id', v_session_id,
    'activated_at', v_activated_at,
    'expires_at', v_expires_at,
    'uses_remaining', v_grant.emergency_uses_remaining - 1
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.revoke_support_admin_emergency(
  p_support_admin_id uuid,
  p_session_id uuid,
  p_admin_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_updated_id uuid;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'Trusted backend required.' USING ERRCODE = '42501';
  END IF;
  IF p_support_admin_id IS NULL OR p_session_id IS NULL OR p_admin_id IS NULL
     OR (p_reason IS NOT NULL AND length(p_reason) > 1000) THEN
    RAISE EXCEPTION 'Invalid emergency-session revocation request.' USING ERRCODE = '22023';
  END IF;
  IF NOT public.is_active_full_admin_actor(p_admin_id) THEN
    RAISE EXCEPTION 'An active full administrator is required to revoke support emergency access.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.support_admin_emergency_sessions
     SET revoked_at = clock_timestamp(),
         revoked_by_admin_id = p_admin_id,
         revoke_reason = COALESCE(p_reason, 'Revoked by administrator')
   WHERE id = p_session_id
     AND support_admin_id = p_support_admin_id
     AND revoked_at IS NULL
     AND expires_at > clock_timestamp()
  RETURNING id INTO v_updated_id;

  IF v_updated_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'message', 'No active session matched.');
  END IF;

  INSERT INTO public.support_admin_activity (
    support_admin_id, emergency_session_id, action, outcome, details
  ) VALUES (
    p_support_admin_id, p_session_id, 'EMERGENCY_MODE_REVOKED', 'succeeded',
    jsonb_build_object('revoked_by_admin_id', p_admin_id, 'reason', COALESCE(p_reason, ''))
  );

  RETURN jsonb_build_object('success', true);
END;
$function$;

ALTER FUNCTION public.configure_support_admin(uuid, uuid, boolean, integer) OWNER TO postgres;
ALTER FUNCTION public.activate_support_admin_emergency(uuid, timestamptz) OWNER TO postgres;
ALTER FUNCTION public.revoke_support_admin_emergency(uuid, uuid, uuid, text) OWNER TO postgres;

REVOKE ALL ON FUNCTION public.configure_support_admin(uuid, uuid, boolean, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.activate_support_admin_emergency(uuid, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_support_admin_emergency(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.configure_support_admin(uuid, uuid, boolean, integer)
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.activate_support_admin_emergency(uuid, timestamptz)
  TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.revoke_support_admin_emergency(uuid, uuid, uuid, text)
  TO service_role, postgres;

COMMIT;
