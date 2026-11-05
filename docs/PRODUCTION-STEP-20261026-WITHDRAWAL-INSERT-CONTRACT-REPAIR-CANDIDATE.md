# Paxones Stage 18 — Withdrawal idempotency insert-contract repair candidate (2026-10-26)

## Work completed
- Traced the defect to the live `public.request_withdrawal` body and local migration history.
- Confirmed the live `onchain_withdrawals.idempotency_key` column is NOT NULL with no default and a unique index exists.
- Compared local definitions: earlier RPCs used a different insert shape, while later platform-ledger/hardened RPC migrations omit the required column. The 2026-10-26 hardening migration modifies the function but does not repair this insert.
- Prepared a fail-closed candidate migration: `supabase/migrations/20261026160000_fix_onchain_withdrawal_idempotency_insert.sql`.
- The candidate checks the expected seven-argument RPC signature and required NOT NULL column, then patches the known insert to write `'w_' || v_withdrawal_id::TEXT`, matching the paired `withdrawals` record's internal key. It refuses unexpected body drift and does not relax NOT NULL or uniqueness.
- Added `tests/withdrawal-onchain-idempotency-contract.test.mjs`.

## Checks
- `node --test tests/withdrawal-onchain-idempotency-contract.test.mjs`: 2 passed, 0 failed.
- `git diff --check` for the candidate migration and static test: passed.
- No live withdrawal was submitted and no production SQL was applied.

## Release gate
This is a candidate migration plus static contract tests only. No disposable schema-faithful PostgreSQL database is available for execution/integration testing. Do not apply it to production until the production migration history is reconciled, a disposable database reproduces the live function/table/index constraints, the migration is applied there, and transactional tests verify paired rows, ledger reservation, duplicate handling, and rollback behavior.

The separate missing `withdrawal_idempotency_keys` table and `request_withdrawal_idempotent` / `lookup_withdrawal_idempotency_replay` RPCs remain unresolved. This candidate does not fix those gaps.

No commit, push, or deployment was performed; existing working-tree changes were preserved.
