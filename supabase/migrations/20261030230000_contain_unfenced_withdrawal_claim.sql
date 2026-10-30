-- SECURITY CONTAINMENT ONLY — this intentionally pauses withdrawal dispatch.
-- The deployed claim_pending_withdrawals(integer) implementation claims every PENDING
-- on-chain withdrawal without verifying paired withdrawal approval or worker ownership.
-- Do not apply until the operations owner explicitly accepts the withdrawal pause.
-- Replace with the reviewed owner-token/lease implementation before re-enabling workers.

BEGIN;

DO $preflight$
BEGIN
  IF to_regprocedure('public.claim_pending_withdrawals(integer)') IS NULL THEN
    RAISE EXCEPTION 'Expected legacy claim_pending_withdrawals(integer) function is missing; aborting containment migration';
  END IF;
  IF to_regprocedure('public.claim_next_pending_withdrawal()') IS NULL THEN
    RAISE EXCEPTION 'Expected legacy claim_next_pending_withdrawal() function is missing; aborting containment migration';
  END IF;
END;
$preflight$;

REVOKE ALL ON FUNCTION public.claim_pending_withdrawals(integer)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION public.claim_pending_withdrawals(integer) TO postgres;

-- A second legacy claim RPC has the same approval/ownership bypass and is also
-- service-role callable in the inspected production catalog.
REVOKE ALL ON FUNCTION public.claim_next_pending_withdrawal()
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

GRANT EXECUTE ON FUNCTION public.claim_next_pending_withdrawal() TO postgres;

COMMIT;
