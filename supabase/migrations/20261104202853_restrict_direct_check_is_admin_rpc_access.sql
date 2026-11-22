-- Remove unnecessary direct Data API access to the parameterized admin predicate.
-- RLS and SECURITY DEFINER server functions continue to invoke this function as its owner.
-- verify_admin_login remains authenticated-callable because middleware uses it for the
-- current signed-in identity; is_admin() remains authenticated-callable for RLS policies.

BEGIN;

DO $migration$
BEGIN
    IF to_regprocedure('public.check_is_admin(uuid,uuid)') IS NULL THEN
        RAISE EXCEPTION 'Required public.check_is_admin(uuid,uuid) function is missing; refusing ACL change.';
    END IF;
END;
$migration$;

REVOKE ALL PRIVILEGES
    ON FUNCTION public.check_is_admin(uuid, uuid)
    FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
    ON FUNCTION public.check_is_admin(uuid, uuid)
    TO service_role, postgres, supabase_auth_admin;

ALTER FUNCTION public.check_is_admin(uuid, uuid)
    SET search_path = '';

COMMENT ON FUNCTION public.check_is_admin(uuid, uuid) IS
    'Trusted internal admin predicate. Direct authenticated/anon RPC execution is revoked; use verify_admin_login for current-user verification and is_admin for RLS context.';

COMMIT;
