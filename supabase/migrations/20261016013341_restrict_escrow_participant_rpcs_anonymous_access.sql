REVOKE EXECUTE ON FUNCTION public.cancel_p2p_trade(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_p2p_trade(uuid, uuid, text) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.mark_p2p_trade_paid(uuid, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_p2p_trade_paid(uuid, uuid, text) TO authenticated, service_role;