-- Harden the SECURITY DEFINER escrow-initiation RPC against search_path object shadowing.
-- The live function references application tables and auth helpers with explicit schemas;
-- PostgreSQL's pg_catalog remains implicitly searchable when search_path is empty.
-- Prepared locally only. Validate with the full migration chain before any deployment.
BEGIN;

ALTER FUNCTION public.initiate_trade_with_escrow(
    text, numeric, numeric, text, numeric, text, text, text, uuid
) SET search_path = '';

COMMIT;
