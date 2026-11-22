# Paxones Production Audit — Withdrawal Migration Reproducibility (2026-10-30)

## Step 169 result
Reviewed local withdrawal table/RPC migrations and prior read-only production drift findings. This step is repository-only; no live database was queried or changed.

## Confirmed local migration-chain facts
- `20260903000001_onchain_withdrawals.sql` creates `public.onchain_withdrawals` without an `idempotency_key` column.
- `20260903000002_withdrawal_rpcs.sql` inserts into that table without `idempotency_key`, matching the table as created in that migration.
- The later local canonical/hardening withdrawal RPC definitions reviewed in the prior audit also omit the column from the `onchain_withdrawals` insert.
- The repository's existing provenance report says it did not find a checked-in migration adding `public.onchain_withdrawals.idempotency_key`, while prior read-only production catalog results showed the column as `NOT NULL`, without a default, and with a unique index.
- The production database was previously observed to lack `withdrawal_idempotency_keys`, `request_withdrawal_idempotent(...)`, and `lookup_withdrawal_idempotency_replay(...)`, even though the local application expects them.
- Therefore, the checked-in migration chain is not currently proven to reproduce the observed production withdrawal schema and RPC contract. The source of the extra production column/index remains unknown.

## Candidate migration assessment
`20261026160000_fix_onchain_withdrawal_idempotency_insert.sql` is deliberately narrow: it requires the seven-argument RPC signature, checks that the idempotency column is present and NOT NULL, verifies the expected INSERT shape, and refuses to patch a body that differs from that shape. This is a useful fail-closed guard, but **not a portable schema repair** because it does not establish the missing column's provenance or create it in a clean database. It also does not restore the separate client idempotency table/wrapper/replay lookup.

Do not apply the candidate to production or staging until migration provenance and the target schema are reconciled. Do not remove the NOT NULL/unique constraint or bypass replay protection as a workaround.

## Verification performed
- Migration filename/version preflight scanned **164** local migration files: **passed**, all version prefixes valid and unique.
- Migration preflight unit tests: **4 passed, 0 failed**.
- Withdrawal idempotency migration contract tests: **3 passed, 0 failed**.
- Overall selected tests in this step: **7 passed, 0 failed**.

These checks validate filenames and source-level assertions only. They do not execute SQL, validate PostgreSQL function replacement semantics, prove deployed grants, or test concurrent reservations and rollback.

## Release gates
1. Recover the exact production change that introduced `onchain_withdrawals.idempotency_key` and its unique index, including backfill and uniqueness semantics.
2. Export authoritative production definitions for the withdrawal tables, indexes, constraints, triggers, all relevant RPC overloads, grants, and migration ledger using read-only access.
3. Reconcile local migration history with the authoritative schema without deleting production data or weakening constraints.
4. In a disposable schema-faithful PostgreSQL environment, apply the proposed sequence from a clean baseline and from a production-like baseline.
5. Test successful reservation, missing-column rollback, duplicate same-key replay, same-key/different-intent rejection, concurrent same-key requests, cross-user key reuse, and exact ledger/liability results.
6. Re-query the deployed schema/function hashes and grants after any approved deployment.

## Safety
- No production SQL executed in this step.
- No migration applied.
- No withdrawal submitted.
- No commit, push, or deployment.
- No GitHub Actions minutes used.
- Existing working-tree changes preserved.

**Status: Migration filename preflight passes; withdrawal migration reproducibility is still UNVERIFIED and remains a production release blocker.**