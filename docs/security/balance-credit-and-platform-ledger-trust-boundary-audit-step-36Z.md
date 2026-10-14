# Step 36Z — Live Balance-Credit and Platform-Ledger RPC Trust-Boundary Audit

Date: 2026-10-14  
Scope: read-only audit of production Supabase project `eaiwgfxoiwxepinvcykg` (`paxonesflows`) and available GitHub search results. No database rows, schema, privileges, or application code were changed in this step.

## Executive result

**Do not re-enable automatic deposit credit or call the legacy credit functions.** The deployed `credit_user_balance(uuid,text,text,numeric)` function is incompatible with the live wallet schema. The older `credit_onchain_deposit(text,text,numeric,text,text)` function is also incompatible with the deployed deposit/wallet model and is not executable by `anon`, `authenticated`, or `service_role` in the inspected ACL snapshot. This is a fail-closed state, but deposits may remain pending until a verified replacement is designed, tested, and deployed.

## Findings

### 1. `credit_user_balance` has a confirmed live schema mismatch — critical

The function is `SECURITY DEFINER`, uses an empty search path with qualified object names, and is executable by `service_role` only among the inspected application roles. Its definition attempts to:

- insert into `public.wallets(user_id, currency)`, although the live `wallets` table has required `chain`, `address`, and `derivation_index` columns and no defaults were verified for those required fields;
- insert/update `public.wallet_assets.available` and `public.wallet_assets.locked`, while the live table instead exposes `balance`, `locked_balance`, `reserved_balance`, and other columns; `available` and `locked` are absent;
- insert a `deposit` row into `ledger_entries` without a canonical reference/idempotency key, despite a deposit-reference uniqueness guard existing for non-null references.

Therefore the function is not compatible with the current schema; it is expected to error, at least on a first wallet insert or the wallet-assets upsert. This is a catalog/source-based conclusion, not a live RPC invocation; no financial RPC was executed.

### 2. `credit_onchain_deposit` is a legacy, mismatched credit path — critical

The function is `SECURITY DEFINER` with pinned empty search path, but the inspected ACL reports it is not executable by `anon`, `authenticated`, or `service_role`. Its body expects `onchain_deposits` columns/semantics that differ from the current canonical schema, including inserting a status of `COMPLETED` and using a global `tx_hash` duplicate check rather than canonical network + transaction hash + output-index identity. It writes to `public.balances` and `public.financial_ledger`, which are not the established current balance/ledger pair in this audit. Do not grant execute or route new deposits to it.

### 3. `record_platform_ledger_entry` is safer for idempotent event recording, but not a balance-credit authorization mechanism

The function is `SECURITY DEFINER`, uses `search_path = public, pg_temp`, and is executable by `service_role` only among the inspected application roles. It validates required entry type/asset, positive amount, direction, and non-empty idempotency key; it uses a unique-key conflict loop and rejects a reused key when the stored event fields differ. However, the function trusts the privileged caller to supply event type, amount, direction, references, and related user. It writes only to `platform_ledger_entries`; it does not prove on-chain deposit finality and does not itself authorize user balance credit. Audit every service-role caller before treating it as a trusted accounting primitive.

### 4. Caller discovery is incomplete

Live Postgres function-source search found `credit_onchain_deposit` referencing `credit_user_balance` by name, but that does not prove a runtime call; the inspected function body shown in this report uses a different legacy balance path. GitHub code search returned no indexed matches for the two function names or `platform_ledger_entries`. That is not proof there are no callers: worker files, generated code, external services, or unindexed files may call the RPCs. A complete caller inventory remains required before any privilege or schema change.

## Required next actions (not performed here)

1. Keep legacy/unverified deposit-credit RPCs disabled.
2. Inventory every API route, cron/worker, trigger, edge function, and external service that can write balances or call privileged ledger RPCs.
3. Select one authoritative balance store and one user-ledger contract; do not bridge legacy tables by guessing.
4. Design a replacement credit transaction that verifies the canonical `onchain_deposits` row is confirmed and uniquely identified by normalized network + tx hash + output index; validates amount/asset/address/status; enforces idempotency; and updates balance plus ledger atomically.
5. Test the replacement against staging, including replay, concurrent duplicate delivery, wrong network/asset/address, insufficient confirmations, reverted/failed transaction, and database error rollback.
6. Only after review and tests, prepare a migration and staged rollout. Do not grant execute to `anon`/authenticated or service role broadly.

## Verification performed

- Read live function definitions, `SECURITY DEFINER` flags, search-path settings, ACLs, and role-level execute checks.
- Read live column metadata for `wallets`, `wallet_assets`, `ledger_entries`, `platform_ledger_entries`, and `onchain_deposits`.
- Ran a read-only database function-source search for references to the two RPC names.
- Attempted GitHub code searches; no indexed results were returned.
- No RPCs were executed. No production or staging data/schema/privileges changed. No application build or automated tests were run.

## Status

**Step 36Z audit complete; production readiness not achieved.** This step records findings only. The next step should continue the caller inventory, prioritizing all service-role routes and workers that can credit balances or write platform ledger events.
