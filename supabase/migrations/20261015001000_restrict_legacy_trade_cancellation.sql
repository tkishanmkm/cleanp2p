-- This legacy SECURITY DEFINER routine has no caller/participant authorization,
-- writes obsolete wallet columns, and can mark arbitrary trades cancelled.
-- Disable client-role execution until it is replaced by an authorized canonical
-- cancellation/refund implementation.
REVOKE EXECUTE ON FUNCTION public.cancel_trade_and_release_escrow(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_trade_and_release_escrow(uuid, text) TO service_role;
