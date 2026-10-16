REVOKE EXECUTE ON FUNCTION public.sync_user_reputation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_user_reputation() TO service_role;
