-- Security hardening: prevent API roles from using TRUNCATE on financial tables.
-- TRUNCATE bypasses row-level security. This migration intentionally leaves
-- ordinary table DML grants unchanged pending a route-by-route privilege audit.
-- Apply first in staging and verify app flows before production rollout.

REVOKE TRUNCATE ON TABLE
  public.wallet_assets,
  public.user_wallets,
  public.transfers,
  public.ledger_entries,
  public.platform_ledger_entries,
  public.deposit_addresses,
  public.deposits,
  public.onchain_withdrawals,
  public.withdrawals
FROM PUBLIC, anon, authenticated;
