REVOKE EXECUTE ON FUNCTION public.generate_random_username() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_random_username() TO service_role;
