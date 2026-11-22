-- Retire obsolete custodial withdrawal RPCs that bypass the durable broadcast queue.
-- Current application routes use approve_withdrawal, reject_withdrawal_pending_approval,
-- the worker-scoped claim/nonce/persist/broadcast RPCs, and the guarded settlement RPCs.
-- Keep these legacy functions present for migration compatibility, but prevent them from
-- being invoked directly by any API role. SECURITY DEFINER wrapper-internal calls, if any,
-- continue to execute as the function owner.

BEGIN;

REVOKE ALL PRIVILEGES ON FUNCTION public.claim_next_pending_withdrawal()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.complete_custodial_withdrawal(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.fail_and_refund_withdrawal(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.refund_reverted_custodial_withdrawal(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.cancel_custodial_withdrawal(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.refund_custodial_withdrawal(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- These legacy function bodies use fully qualified application tables, so pin the
-- remaining stored execution context to pg_catalog only even if future grants change.
ALTER FUNCTION public.claim_next_pending_withdrawal()
  SET search_path = '';

ALTER FUNCTION public.refund_reverted_custodial_withdrawal(uuid, text, text)
  SET search_path = '';

COMMIT;