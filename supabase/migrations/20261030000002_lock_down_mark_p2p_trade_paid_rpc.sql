-- Restrict the financial state transition RPC to trusted server code.
-- The app route verifies the authenticated buyer and invokes this RPC using
-- the service-role client. Authenticated clients must not call it directly,
-- because the SECURITY DEFINER function accepts a caller ID parameter and
-- historically included user-editable metadata in its admin-role check.
REVOKE EXECUTE ON FUNCTION public.mark_p2p_trade_paid(uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.mark_p2p_trade_paid(uuid, uuid, text)
  TO service_role;
