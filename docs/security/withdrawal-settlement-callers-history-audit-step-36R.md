# Withdrawal settlement caller and historical consistency audit — Step 36R

Date: 2026-10-14  
Scope: read-only audit of production withdrawal settlement and refund paths, their current worker callers, and historical row consistency.

## Result

**Step 36R is audit-only. No production database rows, schema, privileges, or application code were changed. No tests were run.**

### Production data snapshot

Read-only queries against production project `eaiwgfxoiwxepinvcykg` returned:
- `public.onchain_withdrawals`: 0 rows
- `public.withdrawals`: 0 rows
- Status/hash breakdown for `onchain_withdrawals`: no grouped rows

This means there are no historical records in these two queried tables to reconcile at the time of the audit. It does **not** prove that there are no pending liabilities in other wallet/ledger tables, that a different environment is empty, or that future writes are safe. Before launch, verify the app is pointing to the intended production project and reconcile all related wallet liabilities and ledger rows.

### Settlement RPC and worker caller findings

The live `public.complete_onchain_withdrawal(uuid,text,numeric,text)` definition and branch worker `src/jobs/withdrawalWorker.ts` were inspected.

1. The worker calls settlement only after chain-specific confirmation/success checks for TRON, EVM, BTC, and LTC paths, and requires the RPC result to explicitly contain `success === true` before counting a withdrawal as confirmed.
2. The worker passes the transaction hash read from the selected `onchain_withdrawals` row to the settlement RPC. This caller behavior is useful but is not a substitute for database-side hash binding.
3. The live settlement RPC does not require the supplied hash to match the stored hash on nonterminal rows before writing completion. It can overwrite the stored hash.
4. An already completed/confirmed row with a NULL stored hash can return success for an arbitrary non-empty supplied hash.
5. The function can fall back to a legacy `withdrawals` row if no `onchain_withdrawals` row exists, then attempts updates to both tables without checking that exactly one matching row was updated in each table.
6. The function deducts `wallet_assets.in_withdrawal` and writes an idempotent ledger row, but the table-pair integrity checks are incomplete. The function should not be considered production-safe until a transaction-bound, strict-state, paired-record settlement path is implemented and tested.
7. The worker still calls `process_failed_withdrawal` for local/pre-broadcast validation failures with `p_is_verified_unbroadcast: true`. The RPC trusts this caller-supplied boolean rather than independently proving no broadcast occurred. Treat this as an unresolved refund authorization boundary.
8. GitHub code search returned no indexed matches for the RPC names; this is inconclusive because the repository search index can miss symbols. The fetched worker confirms the callers described above, but this audit does not claim an exhaustive inventory of every deployed external caller.

### Required next actions

- Design a single authoritative settlement operation that locks and validates the withdrawal, binds the supplied transaction hash to the persisted broadcast hash, accepts only explicitly allowed states, and verifies paired-row identity/existence before touching liabilities.
- Keep settlement and ledger mutation atomic; require exact row counts for paired updates and make repeat calls idempotent only when the existing stored hash and final state match.
- Replace caller-trusted refund booleans with independently verifiable pre-broadcast evidence or an operator-controlled reconciliation process. Preserve reserves when uncertain.
- Add staging tests for hash mismatch, NULL stored hash on terminal rows, missing legacy/on-chain pair, invalid statuses, duplicate hash, repeated settlement, insufficient reserved liability, and ledger idempotency.
- Before production rollout, reconcile `wallet_assets.in_withdrawal`, withdrawal records, and ledger entries. The two withdrawal tables were empty in this snapshot, but related balances were not modified or fully reconciled in this step.

## Status

- Audit: complete for the scoped live function and fetched worker.
- Production data mutation: none.
- Application code mutation: none.
- Automated tests/build: not run.
- Production readiness: **not yet ready for launch**; settlement hash binding and paired-record integrity remain blockers.
