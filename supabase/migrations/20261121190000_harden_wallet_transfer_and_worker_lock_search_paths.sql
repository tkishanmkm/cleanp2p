-- Harden wallet-transfer and withdrawal-worker lock SECURITY DEFINER RPCs.
-- All application tables/functions in these reviewed definitions are schema-qualified;
-- built-ins remain available from pg_catalog with an empty search_path.
-- This migration changes no balances, ledger rows, grants, or transaction behavior.

BEGIN;

DO $wallet_rpc_preflight$
DECLARE
  v_signature TEXT;
  v_oid OID;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.execute_internal_transfer(uuid,text,text,numeric,text)',
    'public.execute_wallet_transfer(uuid,uuid,text,numeric,numeric,text)',
    'public.acquire_withdrawal_worker_lock()',
    'public.release_withdrawal_worker_lock()'
  ]
  LOOP
    v_oid := pg_catalog.to_regprocedure(v_signature);
    IF v_oid IS NULL THEN
      RAISE EXCEPTION 'Wallet search-path hardening refused: required function % is missing.', v_signature;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_catalog.pg_proc p
      WHERE p.oid = v_oid
        AND p.prosecdef IS TRUE
        AND pg_catalog.pg_get_userbyid(p.proowner) = 'postgres'
    ) THEN
      RAISE EXCEPTION 'Wallet search-path hardening refused: % must be postgres-owned SECURITY DEFINER.', v_signature;
    END IF;
  END LOOP;
END;
$wallet_rpc_preflight$;

ALTER FUNCTION public.execute_internal_transfer(UUID,TEXT,TEXT,NUMERIC,TEXT)
  SET search_path = '';

ALTER FUNCTION public.execute_wallet_transfer(UUID,UUID,TEXT,NUMERIC,NUMERIC,TEXT)
  SET search_path = '';

ALTER FUNCTION public.acquire_withdrawal_worker_lock()
  SET search_path = '';

ALTER FUNCTION public.release_withdrawal_worker_lock()
  SET search_path = '';

COMMENT ON FUNCTION public.execute_internal_transfer(UUID,TEXT,TEXT,NUMERIC,TEXT)
  IS 'Canonical server-only wallet_assets internal transfer RPC. Uses an empty search_path.';

COMMENT ON FUNCTION public.execute_wallet_transfer(UUID,UUID,TEXT,NUMERIC,NUMERIC,TEXT)
  IS 'Deprecated legacy multi-table transfer RPC. Current application uses execute_internal_transfer; do not add new callers.';

COMMIT;
