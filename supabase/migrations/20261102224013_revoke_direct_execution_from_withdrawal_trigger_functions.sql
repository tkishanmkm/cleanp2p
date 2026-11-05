-- Trigger-only security-definer functions must not be callable as PostgREST RPCs.
-- PostgreSQL checks EXECUTE when creating the trigger; trigger execution itself is
-- not disabled by revoking direct EXECUTE privileges from API roles.

BEGIN;

REVOKE ALL PRIVILEGES ON FUNCTION public.guard_gas_funding_signed_material()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.guard_onchain_withdrawal_broadcast_record()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.guard_onchain_withdrawal_nonce_reservation()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.sync_onchain_withdrawal_broadcast_state()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL PRIVILEGES ON FUNCTION public.sync_utxo_reservation_status_from_sweep()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;
