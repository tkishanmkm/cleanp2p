BEGIN;

-- Supabase Auth's internal database role must not be an executor of application
-- withdrawal RPCs. These routines are either restricted to the service role,
-- retired legacy paths, or trigger-only functions. Keep their current
-- service_role/PUBLIC/anon/authenticated ACL decisions unchanged.
DO $migration$
DECLARE
  v_function record;
BEGIN
  FOR v_function IN
    SELECT p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_args
    FROM pg_catalog.pg_proc p
    JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname ILIKE '%withdraw%'
      AND EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
        WHERE a.grantee = (SELECT oid FROM pg_catalog.pg_roles WHERE rolname = 'supabase_auth_admin')
          AND a.privilege_type = 'EXECUTE'
      )
  LOOP
    EXECUTE pg_catalog.format(
      'REVOKE EXECUTE ON FUNCTION public.%I(%s) FROM supabase_auth_admin',
      v_function.proname,
      v_function.identity_args
    );
  END LOOP;
END
$migration$;

COMMIT;