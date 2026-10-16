-- The withdrawal claimant is a SECURITY DEFINER worker RPC that changes
-- withdrawal rows to processing. It must never be callable by browser roles.
REVOKE ALL ON FUNCTION public.claim_pending_withdrawals(INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_pending_withdrawals(INTEGER) FROM anon;
REVOKE ALL ON FUNCTION public.claim_pending_withdrawals(INTEGER) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.claim_pending_withdrawals(INTEGER) TO service_role;

COMMENT ON FUNCTION public.claim_pending_withdrawals(INTEGER) IS
  'Worker-only RPC: atomically claims queued withdrawals. Execute only as service_role.';
