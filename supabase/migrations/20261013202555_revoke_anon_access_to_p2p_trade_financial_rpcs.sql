
BEGIN;
REVOKE EXECUTE ON FUNCTION public.initiate_p2p_trade(uuid, uuid, uuid, numeric, text, numeric, numeric, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_p2p_trade(uuid, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_trade(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.complete_trade_atomic(uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancel_p2p_trade_atomic(uuid, uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.cancel_trade_and_release_escrow(uuid, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.finalize_p2p_release(uuid, uuid, numeric, text) FROM anon;
COMMIT;
