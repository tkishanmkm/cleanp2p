-- These account-wide mutations are only called by authenticated server routes
-- using the service-role client after verifyServerAdmin has authorized the user.
REVOKE EXECUTE ON FUNCTION public.admin_freeze_user(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_set_emergency_mode(boolean, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_unfreeze_user(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_update_user_role(uuid, uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_bulk_ban_atomic(uuid, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_bulk_restrict_atomic(uuid, text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_bulk_unban_atomic(uuid, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.execute_bulk_unrestrict_atomic(uuid, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.admin_freeze_user(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_set_emergency_mode(boolean, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_unfreeze_user(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_update_user_role(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_bulk_ban_atomic(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_bulk_restrict_atomic(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_bulk_unban_atomic(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.execute_bulk_unrestrict_atomic(uuid, text) TO service_role;