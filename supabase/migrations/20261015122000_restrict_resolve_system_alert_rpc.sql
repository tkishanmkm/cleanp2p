REVOKE EXECUTE ON FUNCTION public.resolve_system_alert(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_system_alert(uuid, uuid) TO service_role;
