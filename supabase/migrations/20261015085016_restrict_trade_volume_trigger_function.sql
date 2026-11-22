REVOKE EXECUTE ON FUNCTION public.handle_trade_volume_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_trade_volume_update() TO service_role;