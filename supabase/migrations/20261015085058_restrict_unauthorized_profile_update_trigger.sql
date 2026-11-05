REVOKE EXECUTE ON FUNCTION public.prevent_unauthorized_profile_updates() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_unauthorized_profile_updates() TO service_role;