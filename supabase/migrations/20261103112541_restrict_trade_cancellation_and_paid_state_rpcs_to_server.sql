BEGIN;

-- All user-facing cancellation and payment actions now pass through server
-- API routes that authenticate the Supabase session, verify the caller's
-- participant role and invoke the RPC with the service-role client.
REVOKE ALL PRIVILEGES
  ON FUNCTION public.cancel_p2p_trade(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.cancel_p2p_trade(uuid,uuid,text)
  TO service_role;

-- mark_p2p_trade_paid is likewise invoked only by the validated buyer API
-- route or the provisioned-admin review route.
REVOKE ALL PRIVILEGES
  ON FUNCTION public.mark_p2p_trade_paid(uuid,uuid,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE
  ON FUNCTION public.mark_p2p_trade_paid(uuid,uuid,text)
  TO service_role;

ALTER FUNCTION public.cancel_p2p_trade(uuid,uuid,text)
  SET search_path = '';

ALTER FUNCTION public.mark_p2p_trade_paid(uuid,uuid,text)
  SET search_path = '';

COMMIT;
