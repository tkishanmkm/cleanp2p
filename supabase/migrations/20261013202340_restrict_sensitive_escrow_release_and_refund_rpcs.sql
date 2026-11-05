
BEGIN;
REVOKE EXECUTE ON FUNCTION public.release_escrow(uuid, uuid, character varying, numeric)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_escrow(uuid, uuid)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_escrow_funds(uuid, character varying, public.chain_network, numeric)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_escrow_to_buyer(uuid)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_disputed_escrow(uuid, character varying, public.chain_network, numeric)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refund_trade_escrow_to_seller(uuid, uuid, text)
  FROM anon, authenticated;
COMMIT;
