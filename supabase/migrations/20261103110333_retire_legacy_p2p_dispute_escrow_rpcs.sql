BEGIN;

-- These functions only mutated the retired wallet_balances model and had no
-- callers in current application code or other database functions.
REVOKE ALL PRIVILEGES
  ON FUNCTION public.release_escrow_funds(uuid,character varying,chain_network,numeric)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.refund_disputed_escrow(uuid,character varying,chain_network,numeric)
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
