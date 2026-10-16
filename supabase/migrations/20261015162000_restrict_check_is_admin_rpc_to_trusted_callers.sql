-- Prevent authenticated clients from probing arbitrary user IDs through check_is_admin.
-- SECURITY DEFINER functions owned by the migration/function owner can still call this helper.
REVOKE EXECUTE ON FUNCTION public.check_is_admin(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_is_admin(uuid, uuid) TO service_role;
