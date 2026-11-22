-- Restore the authenticated presence heartbeat without changing profile-read policies.
-- This is intentionally isolated from the legacy public-profile projection migration.
BEGIN;

CREATE OR REPLACE FUNCTION public.set_my_presence(p_is_online boolean DEFAULT true)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' OR v_user_id IS NULL THEN
    RAISE EXCEPTION 'An authenticated user session is required.'
      USING ERRCODE = '42501';
  END IF;

  IF p_is_online IS NULL THEN
    RAISE EXCEPTION 'Presence state is required.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
     SET is_online = p_is_online,
         last_seen_at = pg_catalog.clock_timestamp()
   WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Authenticated user profile was not found.'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN true;
END;
$function$;

ALTER FUNCTION public.set_my_presence(boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.set_my_presence(boolean)
  FROM PUBLIC, anon, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.set_my_presence(boolean)
  TO authenticated, postgres;

COMMIT;
