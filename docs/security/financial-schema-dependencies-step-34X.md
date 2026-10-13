# Step 34X — Financial schema dependency and privileged-policy audit

Read-only inspection of production and staging. No schema, migration, role, secret, data, cron, or deployment changes were made.

## Production/staging baseline

Production project `eaiwgfxoiwxepinvcykg` currently reports 80 public tables, 200 public routines, 42 public triggers, 118 public RLS policies, and 269 public indexes. Staging project `tazvjyrdondcrdrkggqe` reports zero public tables/routines/triggers/policies/indexes. Supabase migration listing returned 12 production records and none for staging, while the repository contains 108 migration files. A full migration replay is not proven to reproduce production.

## Production financial trigger dependencies

Read-only catalog inspection found these relevant trigger dependencies:
- `escrow_ledger`: `trg_protect_escrow_ledger_immutability` BEFORE UPDATE → `fn_protect_escrow_ledger_immutability()`
- `user_deposit_addresses`: `on_deposit_address_inserted` AFTER INSERT/UPDATE → `sync_deposit_addresses_to_profile()`
- `user_deposit_addresses`: `trg_sync_deposit_addresses` AFTER INSERT/UPDATE → `sync_user_deposit_addresses_to_profile()`
- `user_wallets`, `wallet_assets`, and `wallets`: `trg_sync_*_balance` BEFORE INSERT/UPDATE → `sync_wallet_locked_reserved_balances()`

The baseline must include these trigger definitions and dependent routines together. Do not create a partial wallet/deposit schema without dependency closure.

## Relevant RLS policy review

Several service-role-only policies use `TO public` with a predicate checking `auth.role() = 'service_role'` (examples: `admin_main_wallets`, `escrow_ledger`, `financial_ledger`, `hot_wallet_nonces`, `hot_wallet_withdrawals`, `sweep_logs`, `sweep_queue`). The predicates observed restrict them to service-role JWTs, but the broad `public` role target and deprecated `auth.role()` style should be normalized only after validating service-role semantics and testing. Do not blanket-revoke these policies, since that could break legitimate workers.

User read policies on `ledger_entries`, `onchain_deposits`, `user_wallets`, `wallet_balances`, `wallet_transactions`, `wallets`, and `withdrawals` use `auth.uid() = user_id` ownership checks. Some target `public`, others `authenticated`; normalize only with call-site review and negative tests.

## Cron / scheduler

Production has one row in `cron.job`: job 1, schedule `*/5 * * * *`, command `SELECT public.auto_cancel_expired_p2p_trades(15);`, username `postgres`, currently inactive. Staging has no `cron.job` relation available in the queried context. Keep scheduler setup disabled during baseline import; explicitly verify before enabling jobs.

## Decision

A baseline must preserve dependency order and review privileged routines/triggers, policy semantics, extension versions, scheduler state, and external integration references. Do not copy production data or secret values. Do not execute historical migrations in bulk. A runnable schema-only baseline has not yet been produced because the available metadata interface does not provide a verified full DDL export with dependency closure.

## Deposit readiness

The live deposit credit trust boundary remains unresolved: `process_deposit_atomic` accepts caller-influenced confirmation values for credit decisions. Staging schema setup alone will not solve that. Deposits remain NOT READY for production.
