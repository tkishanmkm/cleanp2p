# Paxones Stage 21 — Ledger contract blast-radius inventory

Date: 2026-10-26. Environment: read-only production catalog for Supabase project `eaiwgfxoiwxepinvcykg`, compared with the local repository. No production writes were executed.

## Decision-changing finding

The live `public.ledger_entries` table is not merely incompatible with two withdrawal functions. It is incompatible with the repository's canonical ledger contract and at least one application-side financial reconciliation path.

### Live production contract observed

Live `ledger_entries` columns: `id`, `user_id`, `crypto`, `amount`, `type`, `reference_id`, `balance_after`, `metadata`, `created_at`, `asset`, `chain`, `status`.

Live type check permits only `deposit`, `withdrawal`, `withdrawal_pending`, `transfer`, and `fee`.

The local initial schema `supabase/migrations/20260831000000_init_schema.sql` defines a materially different canonical ledger: `wallet_id`, `user_id`, `asset_code`, `delta_available`, `delta_locked`, `available_after`, `locked_after`, `entry_type`, `ref_table`, `ref_id`, `idempotency_key`, `created_at`; it requires wallet/asset foreign keys and unique idempotency keys. Its entry-type check is also different.

### Runtime blast radius from local source inspection

- `src/lib/security/reconciliation.ts` selects `wallet_id`, `asset_code`, `delta_available`, and `delta_locked` from `ledger_entries`; this query cannot match the observed production schema and the function explicitly throws on query failure.
- `src/app/api/admin/adjust-balance/route.ts` inserts into `ledger_entries` using an application-specific payload and only logs a warning if the insert fails. That can allow the balance-adjustment route to continue without a durable ledger record unless surrounding logic handles the error elsewhere.
- `src/app/api/check-db-records/route.ts` and `src/app/api/verify-deposit-recovery/route.ts` read `ledger_entries`; their assumptions need checking against the live legacy schema and authorization controls.
- Local migration SQL contains numerous canonical-ledger writers/readers across deposits, withdrawals, and P2P escrow. The production catalog shows a legacy-shaped `ledger_entries` table instead. These functions must not be assumed compatible just because the RPC exists.
- `platform_ledger_entries` is a separate table and is not a substitute for the user asset ledger.

### Live constraints that add risk

- `ledger_entries_type_check` excludes canonical values such as `withdrawal_complete` and `withdrawal_refund`.
- `onchain_withdrawals.idempotency_key` remains `NOT NULL` with no default, while the live reservation RPC omits it.
- `withdrawals` and `onchain_withdrawals` have separate primary keys and user foreign keys, but the inspected constraints do not establish a foreign key pairing their IDs.
- `wallet_assets.balance`, `locked_balance`, `in_escrow`, and `in_withdrawal` remain nullable.

## Remediation decision

Do not try to fix this by blindly adding columns to the live table or by changing its type constraint. The observed table may be a legacy schema still used by some UI/reporting code. Reconcile all writers/readers first, define a controlled migration to a single authoritative ledger model, and prove compatibility in an isolated database.

## Required next stage

1. Produce a full inventory of every `ledger_entries` writer/reader in source, SQL migrations, triggers, and scheduled jobs.
2. Review each runtime API for transactionality, fail-closed behavior, and whether ledger failure can be swallowed.
3. Map production RPCs to exact local migration definitions using function identity signatures and body hashes; mark unrecoverable definitions as unknown.
4. Use a disposable Postgres environment with the production schema snapshot to test all affected operations and rollback semantics.
5. Only after successful tests, prepare one reviewed migration plan and release sequence. No direct production hotfix.

## Safety

This stage only inspected catalog metadata and local source. No user balances, withdrawal rows, ledger entries, grants, or schema objects were changed. No commits, pushes, or deployments were made. The working tree contains pre-existing modifications and untracked audit work; preserve it and do not reset or overwrite it.
