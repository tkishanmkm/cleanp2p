-- Keep the user-facing withdrawal mirror read-only and lock canonical financial
-- tables to service-role SELECT plus SECURITY DEFINER RPC mutations.
BEGIN;

DROP POLICY IF EXISTS "Users can view their own withdrawals" ON public.withdrawals;
DROP POLICY IF EXISTS "Users view their own withdrawals" ON public.withdrawals;

CREATE POLICY "Users view their own withdrawals"
  ON public.withdrawals
  FOR SELECT
  TO authenticated
  USING (user_id = (SELECT auth.uid()));

REVOKE ALL PRIVILEGES ON TABLE public.withdrawals FROM anon;
REVOKE ALL PRIVILEGES ON TABLE public.withdrawals FROM authenticated;
REVOKE ALL PRIVILEGES ON TABLE public.withdrawals FROM service_role;
GRANT SELECT ON TABLE public.withdrawals TO authenticated, service_role;

-- No application client or worker directly mutates the canonical request table.
-- All inserts/state transitions go through the owner-controlled, service-role
-- SECURITY DEFINER withdrawal RPCs; application code uses SELECT only.
REVOKE ALL PRIVILEGES ON TABLE public.onchain_withdrawals FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.onchain_withdrawals TO service_role;

REVOKE ALL PRIVILEGES ON TABLE public.onchain_withdrawal_broadcasts FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.onchain_withdrawal_broadcasts TO service_role;

REVOKE ALL PRIVILEGES ON TABLE public.onchain_withdrawal_nonce_reservations FROM anon, authenticated, service_role;
GRANT SELECT ON TABLE public.onchain_withdrawal_nonce_reservations TO service_role;

COMMIT;
