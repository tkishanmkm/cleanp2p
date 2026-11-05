CREATE OR REPLACE FUNCTION public.cancel_expired_trades()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO ''
AS $function$
BEGIN
  -- Never mark an escrow-backed trade cancelled without returning funds.
  -- Delegate to the canonical routine that locks the trade and seller asset,
  -- verifies escrow, records the compensating ledger entry, and performs the
  -- terminal state transition atomically. Unrecognized/legacy states are left
  -- untouched for reconciliation rather than cancelled without accounting.
  PERFORM *
  FROM public.expire_unpaid_p2p_trades(15);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.cancel_expired_trades() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_expired_trades() TO service_role;