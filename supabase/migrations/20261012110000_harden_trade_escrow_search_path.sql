-- SECURITY DEFINER escrow RPC uses schema-qualified application relations.
-- Remove mutable application schemas from its runtime search path.
ALTER FUNCTION public.initiate_trade_with_escrow(
  TEXT, NUMERIC, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, TEXT, UUID
) SET search_path = '';
