-- Restrict wallet lock controls to trusted server-side workers.
REVOKE ALL ON FUNCTION public.acquire_hot_wallet_lock() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_hot_wallet_lock() TO service_role;

REVOKE ALL ON FUNCTION public.release_hot_wallet_lock() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.release_hot_wallet_lock() TO service_role;

-- Trigger functions are not client-facing RPCs; remove inherited public execute grants.
REVOKE ALL ON FUNCTION public.fn_protect_escrow_ledger_immutability() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_deposit_addresses_to_profile() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_user_deposit_addresses_to_profile() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.sync_wallet_locked_reserved_balances() FROM PUBLIC, anon, authenticated;
