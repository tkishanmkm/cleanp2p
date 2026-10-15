REVOKE EXECUTE ON FUNCTION public.handle_profile_status_operation_ownership() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_profile_status_operation_ownership() TO service_role;
