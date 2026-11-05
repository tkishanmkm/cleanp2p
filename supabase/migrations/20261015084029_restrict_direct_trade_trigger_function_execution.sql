-- Trigger functions are invoked by their attached triggers, not as RPCs.
-- Remove direct API execution from client roles while preserving trigger behavior.
REVOKE EXECUTE ON FUNCTION public.fn_sync_trade_status_timestamps() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_update_user_trade_metrics() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_trade_status_sync() FROM PUBLIC, anon, authenticated;
