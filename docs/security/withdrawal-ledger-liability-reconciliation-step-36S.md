# Withdrawal liability and ledger reconciliation audit — Step 36S

Date: 2026-10-14  
Environment: production Supabase project `eaiwgfxoiwxepinvcykg`  
Scope: read-only schema/constraint audit for `wallet_assets`, `ledger_entries`, `onchain_withdrawals`, and `withdrawals`.

## Result

**Step 36S is audit-only. No SQL, code, privileges, balances, or ledger rows were changed. No tests were run.**

## Critical schema/function incompatibility

The live definitions of both `public.complete_onchain_withdrawal(uuid,text,numeric,text)` and `public.process_failed_withdrawal(uuid,text,numeric,text,boolean)` attempt to insert into `public.ledger_entries` using columns such as:

- `wallet_id`
- `asset_code`
- `delta_available`
- `delta_locked`
- `available_after`
- `locked_after`
- `entry_type`
- `ref_table`
- `ref_id`
- `idempotency_key`

But the live production `public.ledger_entries` schema returned by `information_schema.columns` contains:

- `id`, `user_id`, `crypto`, `amount`, `type`, `reference_id`, `balance_after`, `metadata`, `created_at`, `asset`, `chain`, `status`

The expected insert columns are absent from the live table schema. This is a **critical schema drift/runtime blocker**: the settlement/refund function's ledger insert can fail when invoked. Since the ledger insert is in the same PostgreSQL transaction as its wallet and withdrawal updates, a resulting statement error should roll back the transaction rather than commit a partial wallet decrement/refund. This expected atomic rollback is safer than partial mutation, but means the workflow may be unable to settle/refund until schema and function contracts are reconciled. No live function invocation was attempted.

## Other relevant schema findings

- `wallet_assets` has a unique constraint on `(user_id, asset_symbol)`, which supports one asset row per user/symbol.
- `wallet_assets.balance`, `locked_balance`, `in_escrow`, and `in_withdrawal` are nullable in the live schema except `reserved_balance`. Financial invariants can be weakened by NULL values unless all write paths normalize/guard them.
- `onchain_withdrawals` has a primary key, positive-amount check, allowed-network/status checks, unique `tx_hash`, and foreign keys to the user and wallet. It has no FK tying its `id` to a matching row in `withdrawals`.
- `withdrawals` has a primary key, allowed-status check, and user FK, but no observed FK to `onchain_withdrawals`.
- Status vocabularies differ between the two withdrawal tables, increasing the risk of state drift across paired writes.
- The `ledger_entries` constraints returned include only its primary key and a type check permitting `deposit`, `withdrawal`, `withdrawal_pending`, `transfer`, and `fee`. That type check does not include the function's intended `withdrawal_complete` or `withdrawal_refund` values. Even after fixing column names, the current type constraint would reject those labels unless the ledger contract is deliberately reconciled.

## Data snapshot

The two direct production count queries previously returned zero rows in `onchain_withdrawals` and `withdrawals`. No data was changed. This does not prove all related wallet balances or ledger history is reconciled.

## Required remediation before production

1. **Do not hot-edit the live functions or ledger table ad hoc.** First choose the authoritative ledger schema and map every current writer/reader of `ledger_entries`.
2. Audit all ledger inserts, reads, reports, constraints, indexes, and idempotency expectations in code and SQL. The live ledger schema lacks the idempotency-key field expected by these withdrawal functions, so idempotency semantics must be designed rather than assumed.
3. Prepare a migration in a branch and validate it in staging, including exact schema compatibility for both completion and refund functions. Avoid blindly adding columns or changing a check constraint before auditing other ledger writers.
4. Add integration tests proving a successful settlement/refund writes the correct ledger entry atomically, repeated requests are idempotent, and a ledger insert failure leaves wallet liabilities and withdrawal statuses unchanged.
5. Separately fix the Step 36R issues: bind settlement to the persisted transaction hash, enforce strict status transitions, and require paired withdrawal rows to match.

## Readiness

**Withdrawal settlement and refund remain blocked from production-readiness approval.** The live schema and function contracts disagree on ledger columns and entry types, in addition to the previously documented hash-binding and paired-record integrity issues.
