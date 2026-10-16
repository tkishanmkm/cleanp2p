-- Harden the legacy trade-creation RPC.
--
-- This routine can create a synthetic advertisement when the supplied ad ID
-- does not exist, and it inserts a pending trade without performing the
-- canonical escrow lock. It must not be callable by public client roles.
-- The canonical authenticated trade path is initiate_trade_with_escrow.
BEGIN;

REVOKE ALL ON FUNCTION public.create_p2p_trade(
  text, uuid, uuid, numeric, numeric, character varying, character varying
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_p2p_trade(
  text, uuid, uuid, numeric, numeric, character varying, character varying
) TO service_role;

COMMIT;
