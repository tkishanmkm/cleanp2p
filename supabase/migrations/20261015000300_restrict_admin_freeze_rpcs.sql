-- Restrict emergency freeze controls to trusted server-side callers.
-- SECURITY REVIEW GATE: this migration is intentionally not applied automatically.
-- Before applying, verify every route/worker caller uses a service-role client AND
-- independently authorizes the initiating admin via verifyServerAdmin/trusted data.
-- The current function bodies trust mutable public.profiles role flags; this ACL
-- restriction is defense-in-depth and does not replace that function-level fix.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.admin_freeze_user(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_freeze_user(uuid, text)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.admin_unfreeze_user(uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_unfreeze_user(uuid, text)
  TO service_role;

DO $assert$
BEGIN
  IF has_function_privilege('anon', 'public.admin_freeze_user(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.admin_freeze_user(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'client EXECUTE remains on admin_freeze_user';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.admin_freeze_user(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute admin_freeze_user';
  END IF;

  IF has_function_privilege('anon', 'public.admin_unfreeze_user(uuid,text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.admin_unfreeze_user(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'client EXECUTE remains on admin_unfreeze_user';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.admin_unfreeze_user(uuid,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute admin_unfreeze_user';
  END IF;
END;
$assert$;

COMMIT;
