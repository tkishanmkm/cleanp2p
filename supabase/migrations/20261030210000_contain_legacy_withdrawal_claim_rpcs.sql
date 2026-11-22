-- Contain legacy withdrawal queue claims that do not use the database owner-token lease.
-- This is source-only until the full migration chain is validated against an isolated,
-- schema-matched database. Never apply this migration by itself to production: it can
-- pause legacy dispatch while the lease-aware worker migration is not yet deployed.
BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.claim_pending_withdrawals(integer)') IS NULL THEN
    RAISE EXCEPTION 'Legacy withdrawal claim containment preflight failed: claim_pending_withdrawals(integer) is missing';
  END IF;
  IF to_regprocedure('public.claim_next_pending_withdrawal()') IS NULL THEN
    RAISE EXCEPTION 'Legacy withdrawal claim containment preflight failed: claim_next_pending_withdrawal() is missing';
  END IF;
END;
$preflight$;

-- The canonical worker uses claim_pending_withdrawals(uuid, integer), introduced by
-- the database-fencing migration. Neither legacy signature may remain callable by
-- service-role or auth-admin callers, even if old worker code is accidentally invoked.
REVOKE ALL ON FUNCTION public.claim_pending_withdrawals(integer)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.claim_pending_withdrawals(integer) TO postgres;

REVOKE ALL ON FUNCTION public.claim_next_pending_withdrawal()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.claim_next_pending_withdrawal() TO postgres;

COMMIT;
