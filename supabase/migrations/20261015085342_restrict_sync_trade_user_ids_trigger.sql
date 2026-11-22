REVOKE EXECUTE ON FUNCTION public.sync_trade_user_ids() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sync_trade_user_ids() TO service_role;