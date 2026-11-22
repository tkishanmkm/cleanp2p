# Paxones Stage 19 — Withdrawal schema provenance and migration reproducibility (2026-10-26)

## Finding: production schema is not reproducible from the checked-in migration chain

The live production catalog has `public.onchain_withdrawals.idempotency_key` as NOT NULL with a unique index and no default. The current production `public.request_withdrawal` function omits this column in its `INSERT`.

Local history review established:
- `20260903000001_onchain_withdrawals.sql` creates `public.onchain_withdrawals` without an `idempotency_key` column.
- `20260903000002_withdrawal_rpcs.sql` also inserts into `onchain_withdrawals` without that column, which is compatible with that migration's table definition.
- Later local migrations `20260928000000_platform_ledger_entries.sql` and `20260928020000_withdrawal_hardened_rpcs.sql` also omit `idempotency_key` from the on-chain withdrawal insert.
- The checked-in migration scan did not find a migration adding `idempotency_key` to `public.onchain_withdrawals` (the visible NOT NULL idempotency declarations belong to other tables).
- Git history shows the original table and first withdrawal RPC were introduced together in commit `01bacca7e5912d04262a99d9ef4174de23fbbcf5`; the later ledger/hardening RPC migrations were introduced in commit `c5cb658b9117a28f6dc9fb882789d3467be4300c`.

This means the live column likely came from an untracked/manual/schema-history operation or an applied migration absent from the local chain. Its authoritative provenance and intended key semantics are not yet proven. Do not assume a local replay of migrations would recreate production.

## Candidate repair status

`supabase/migrations/20261026160000_fix_onchain_withdrawal_idempotency_insert.sql` is a fail-closed candidate for the currently observed live function shape. It does not create or alter the column; it requires the column to already exist. Therefore it is not yet proven to be a portable migration across all environments. Do not apply it to production or an empty staging project until the schema provenance gap is reconciled.

## Tests run in this stage

Command:
`node --test tests/withdrawal-onchain-idempotency-contract.test.mjs tests/withdrawal-idempotency-migration.test.ts tests/withdrawal-refund-forward-hardening.test.ts tests/withdrawal-approval-forward-hardening.test.ts tests/withdraw-refund-route-safety.test.ts`

Result: 14 passed, 0 failed. These are static/contract tests; no PostgreSQL migration execution, concurrent requests, or real financial transaction was tested.

## Required next actions

1. Recover the exact migration or schema operation that added the production `onchain_withdrawals.idempotency_key` column and unique index, including timestamp, SQL body, and any data backfill.
2. Compare production/local table definitions, constraints, indexes, triggers, and the live function definition; record checksums and grant state.
3. Decide the canonical migration history before adding another forward migration. Preserve existing data and uniqueness; do not drop the column or constraint to make old migrations replay.
4. Provision a schema-faithful disposable PostgreSQL/Supabase environment. Current Windows host has no `docker`, `psql`, or `postgres` executable available; the connected staging Supabase project is empty and is not a safe substitute without initializing a verified schema.
5. Test migration execution, successful reservation, rollback on insert failure, same-key retry, same-key/different-intent rejection, and concurrent requests before release.
6. Separately restore/reconcile the missing client idempotency table and RPCs.

## Safety

No production SQL was executed and no withdrawal was submitted. No commit, push, or deployment was performed. Existing working-tree changes were preserved.
