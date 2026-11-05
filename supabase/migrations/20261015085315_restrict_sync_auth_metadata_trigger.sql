REVOKE EXECUTE ON FUNCTION public.sync_auth_metadata_from_profile() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_auth_metadata_from_profile() TO service_role;