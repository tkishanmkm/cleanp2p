-- These SECURITY DEFINER trigger functions are currently unattached.
-- Prevent direct invocation by client roles while preserving trusted server access.
REVOKE EXECUTE ON FUNCTION public.handle_new_user_profile() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user_profile() TO service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user_username() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user_username() TO service_role;
