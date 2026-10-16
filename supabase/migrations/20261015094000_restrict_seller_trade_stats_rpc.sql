-- This RPC accepts an arbitrary target user and returns block-relationship counts.
-- No application caller was found in repository search; restrict until an authorized use is established.
REVOKE EXECUTE ON FUNCTION public.get_seller_trade_stats(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_seller_trade_stats(uuid) TO service_role;
