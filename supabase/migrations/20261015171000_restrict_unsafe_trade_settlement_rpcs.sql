-- Restrict legacy settlement RPCs that do not independently enforce caller/participant authorization.
-- Trusted server-side orchestration must use service_role for these functions.
REVOKE EXECUTE ON FUNCTION public.complete_trade_atomic(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_trade_atomic(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.finalize_p2p_release(uuid, uuid, numeric, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_p2p_release(uuid, uuid, numeric, text) TO service_role;
