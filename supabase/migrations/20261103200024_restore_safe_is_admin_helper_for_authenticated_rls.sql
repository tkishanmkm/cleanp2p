BEGIN;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT
    auth.role() = 'service_role'
    OR public.is_active_admin_identity(auth.uid());
$function$;

REVOKE ALL PRIVILEGES ON FUNCTION public.is_admin()
  FROM PUBLIC, anon, authenticated, service_role;

-- RLS policies call this helper to evaluate the current request actor.
-- It accepts no user ID parameter and checks only auth.uid().
GRANT EXECUTE ON FUNCTION public.is_admin()
  TO authenticated, service_role;

COMMIT;
