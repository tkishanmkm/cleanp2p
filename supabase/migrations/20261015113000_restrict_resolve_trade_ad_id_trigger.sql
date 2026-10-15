REVOKE EXECUTE ON FUNCTION public.resolve_trade_ad_id() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_trade_ad_id() TO service_role;
