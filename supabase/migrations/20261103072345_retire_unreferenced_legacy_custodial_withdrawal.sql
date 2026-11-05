BEGIN;

-- Retire the obsolete custodial request RPC. The active application calls
-- request_withdrawal_idempotent(), whose canonical network matrix is matched
-- by the durable dispatcher. This legacy routine also accepts Polygon USDT,
-- which the current dispatcher cannot broadcast, and bypasses the canonical
-- idempotency/reservation contract.
REVOKE ALL PRIVILEGES
  ON FUNCTION public.request_custodial_withdrawal(uuid, text, text, text, numeric, numeric, text)
  FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin;

ALTER FUNCTION public.request_custodial_withdrawal(uuid, text, text, text, numeric, numeric, text)
  SET search_path = '';

COMMENT ON FUNCTION public.request_custodial_withdrawal(uuid, text, text, text, numeric, numeric, text)
  IS 'Retired legacy endpoint. Use request_withdrawal_idempotent() for the canonical, idempotent withdrawal reservation flow.';

COMMIT;