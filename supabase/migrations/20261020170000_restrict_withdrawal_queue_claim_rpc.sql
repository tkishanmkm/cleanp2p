-- The queue-claim function is SECURITY DEFINER and transitions financial records.
-- Only the trusted worker service role may claim withdrawals.
BEGIN;

REVOKE ALL ON FUNCTION public.claim_pending_withdrawals(INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_withdrawals(INTEGER) TO service_role, postgres;

COMMIT;
