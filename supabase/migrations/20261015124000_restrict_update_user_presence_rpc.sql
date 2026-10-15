REVOKE EXECUTE ON FUNCTION public.update_user_presence(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_user_presence(uuid) TO service_role;
