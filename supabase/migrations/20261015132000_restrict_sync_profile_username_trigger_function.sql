REVOKE EXECUTE ON FUNCTION public.sync_profile_username() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_profile_username() TO service_role;
