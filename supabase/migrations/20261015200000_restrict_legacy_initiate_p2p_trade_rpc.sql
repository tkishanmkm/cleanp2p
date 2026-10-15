-- This legacy wrapper always passes a NULL idempotency key to the canonical
-- function, which requires a non-empty key and therefore cannot successfully
-- initiate a trade. Keep it unavailable to client roles until a compatible,
-- audited replacement exists; preserve service-role access for controlled callers.
REVOKE EXECUTE ON FUNCTION public.initiate_p2p_trade(uuid, uuid, uuid, numeric, text, numeric, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.initiate_p2p_trade(uuid, uuid, uuid, numeric, text, numeric, numeric, text, text) TO service_role;
