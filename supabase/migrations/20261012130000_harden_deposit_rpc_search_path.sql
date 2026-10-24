-- The canonical deposit RPC uses schema-qualified application relations.
-- Remove mutable schemas from its SECURITY DEFINER search path.
ALTER FUNCTION public.process_deposit_atomic(
  text, text, text, numeric, text, integer, bigint, text, text, integer, text
) SET search_path = '';
