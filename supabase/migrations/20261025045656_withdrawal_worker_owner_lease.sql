-- Replace session-scoped advisory locks with a PostgREST-safe owner-token lease.
-- Validate this migration and its concurrency behavior on a schema-matched disposable
-- database before deployment. Never apply to production as an isolated hotfix.
BEGIN;

CREATE TABLE IF NOT EXISTS public.withdrawal_worker_leases (
  lease_name text PRIMARY KEY,
  owner_token uuid,
  expires_at timestamptz NOT NULL DEFAULT '-infinity'::timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT withdrawal_worker_leases_singleton_name
    CHECK (lease_name = 'withdrawal-dispatch')
);

REVOKE ALL ON TABLE public.withdrawal_worker_leases FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.withdrawal_worker_leases TO service_role;

CREATE OR REPLACE FUNCTION public.acquire_withdrawal_worker_lease(
  p_owner_token uuid,
  p_lease_seconds integer DEFAULT 60
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_owner uuid;
BEGIN
  IF p_owner_token IS NULL OR p_lease_seconds IS NULL
     OR p_lease_seconds < 15 OR p_lease_seconds > 300 THEN
    RETURN false;
  END IF;

  INSERT INTO public.withdrawal_worker_leases (lease_name, owner_token, expires_at, updated_at)
  VALUES ('withdrawal-dispatch', p_owner_token, now() + make_interval(secs => p_lease_seconds), now())
  ON CONFLICT (lease_name) DO UPDATE
    SET owner_token = EXCLUDED.owner_token,
        expires_at = EXCLUDED.expires_at,
        updated_at = now()
    WHERE public.withdrawal_worker_leases.expires_at <= now()
       OR public.withdrawal_worker_leases.owner_token = EXCLUDED.owner_token
  RETURNING owner_token INTO v_owner;

  RETURN COALESCE(v_owner = p_owner_token, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.renew_withdrawal_worker_lease(
  p_owner_token uuid,
  p_lease_seconds integer DEFAULT 60
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_owner uuid;
BEGIN
  IF p_owner_token IS NULL OR p_lease_seconds IS NULL
     OR p_lease_seconds < 15 OR p_lease_seconds > 300 THEN
    RETURN false;
  END IF;

  UPDATE public.withdrawal_worker_leases
     SET expires_at = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   WHERE lease_name = 'withdrawal-dispatch'
     AND owner_token = p_owner_token
     AND expires_at > now()
  RETURNING owner_token INTO v_owner;

  RETURN COALESCE(v_owner = p_owner_token, false);
END;
$function$;

CREATE OR REPLACE FUNCTION public.release_withdrawal_worker_lease(
  p_owner_token uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF p_owner_token IS NULL THEN
    RETURN false;
  END IF;

  UPDATE public.withdrawal_worker_leases
     SET owner_token = NULL,
         expires_at = now(),
         updated_at = now()
   WHERE lease_name = 'withdrawal-dispatch'
     AND owner_token = p_owner_token;

  RETURN FOUND;
END;
$function$;

REVOKE ALL ON FUNCTION public.acquire_withdrawal_worker_lease(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.renew_withdrawal_worker_lease(uuid, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_withdrawal_worker_lease(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_withdrawal_worker_lease(uuid, integer) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.renew_withdrawal_worker_lease(uuid, integer) TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.release_withdrawal_worker_lease(uuid) TO service_role, postgres;

COMMIT;
