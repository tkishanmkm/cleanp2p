-- These SECURITY DEFINER routines use schema-qualified application tables.
-- Empty search_path prevents object-shadowing through mutable schemas.
ALTER FUNCTION public.release_trade_escrow(UUID, UUID) SET search_path = '';
