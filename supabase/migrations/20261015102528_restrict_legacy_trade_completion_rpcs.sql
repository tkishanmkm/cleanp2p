REVOKE EXECUTE ON FUNCTION public.complete_trade(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_trade(uuid) TO service_role;
REVOKE EXECUTE ON FUNCTION public.complete_p2p_trade(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_p2p_trade(uuid, uuid) TO service_role;