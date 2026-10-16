REVOKE EXECUTE ON FUNCTION public.generate_system_username() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_system_username() TO service_role;
