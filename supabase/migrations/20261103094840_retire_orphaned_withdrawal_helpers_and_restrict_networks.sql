BEGIN;

-- The canonical dispatcher supports only USDT on TRC20/ERC20/BEP20 and ETH
-- on ERC20. Remove the obsolete Polygon allowance and enforce the pair itself.
ALTER TABLE public.onchain_withdrawals
  DROP CONSTRAINT IF EXISTS onchain_withdrawals_network_check;

ALTER TABLE public.onchain_withdrawals
  ADD CONSTRAINT onchain_withdrawals_asset_network_check
  CHECK (
    (upper(asset_symbol) = 'USDT' AND upper(network) IN ('TRC20', 'ERC20', 'BEP20'))
    OR
    (upper(asset_symbol) = 'ETH' AND upper(network) = 'ERC20')
  );

-- These helpers belong to the retired worker architecture. The active worker
-- claims rows with the lease-aware claim_pending_withdrawals(integer,text) RPC.
-- The HTTP trigger is unattached, while advisory lock/unlock RPCs cannot span
-- separate PostgREST connections. The old velocity helper is not called.
REVOKE ALL PRIVILEGES
  ON FUNCTION public.trigger_withdrawal_worker()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.check_user_withdrawal_velocity(uuid, numeric, numeric)
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.acquire_withdrawal_worker_lock()
  FROM PUBLIC, anon, authenticated, service_role;

REVOKE ALL PRIVILEGES
  ON FUNCTION public.release_withdrawal_worker_lock()
  FROM PUBLIC, anon, authenticated, service_role;

COMMIT;