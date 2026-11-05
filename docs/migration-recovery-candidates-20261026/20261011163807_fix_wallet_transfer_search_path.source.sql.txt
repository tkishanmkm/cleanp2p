-- Harden the SECURITY DEFINER transfer RPC against search_path shadowing.
-- Keep the existing service_role-only EXECUTE grants unchanged.
ALTER FUNCTION public.execute_wallet_transfer(uuid, uuid, text, numeric, numeric, text)
  SET search_path = pg_catalog, public, pg_temp;
