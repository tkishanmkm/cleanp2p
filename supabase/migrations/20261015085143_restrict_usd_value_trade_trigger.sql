REVOKE EXECUTE ON FUNCTION public.prevent_usd_value_at_trade_update() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prevent_usd_value_at_trade_update() TO service_role;