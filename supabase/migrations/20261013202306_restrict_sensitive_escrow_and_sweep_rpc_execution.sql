
BEGIN;

REVOKE EXECUTE ON FUNCTION public.lock_escrow(uuid, character varying, numeric)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lock_escrow_funds(uuid, character varying, public.chain_network, numeric)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.lock_p2p_escrow(uuid, uuid, numeric)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_gas_funded(uuid, text)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.mark_swept(uuid, text)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.process_trade_escrow()
  FROM anon, authenticated;

COMMIT;
