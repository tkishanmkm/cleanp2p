# Withdrawal DB State and Constraint Audit — Step 36P

Date: 2026-10-14  
Scope: read-only inspection of production schema for `public.onchain_withdrawals` and `public.withdrawals`, plus the active worker on branch `fix/retire-unverified-deposit-entrypoints`.

## Result

**Audit only. No production data, schema, privileges, or application code changed. No tests were run.**

## Findings

1. **Transaction hash is nullable on the canonical on-chain table.** `onchain_withdrawals.tx_hash` is nullable, which is necessary before broadcast, but the schema does not itself express the invariant that `COMPLETED` must have a non-empty transaction hash. The settlement RPC audit in Step 36M found that a completed row with no stored hash can accept a supplied hash and that a nonterminal row is not checked against the persisted broadcast hash before settlement.

2. **Status constraints validate allowed labels, not valid transitions.** The table checks permit statuses such as `PROCESSING`, `AMBIGUOUS_BROADCAST`, `BROADCASTED`, `COMPLETED`, and failure/cancellation labels. They do not by themselves prevent unsafe transitions such as settling a row from an unexpected state.

3. **The two withdrawal tables are not tied together by a declared foreign key.** Both tables have their own primary key and user foreign key; the inspected constraints show no database foreign key binding the corresponding `withdrawals.id` to `onchain_withdrawals.id`. Worker code updates the two records separately, so partial persistence remains possible despite checking returned errors.

4. **Duplicate transaction-hash protections exist on the canonical table.** A unique index exists on `tx_hash`, plus a normalized lower/trim unique partial index for non-empty hashes. This helps prevent duplicate hash assignment in that table, but does not prove that a hash belongs to the withdrawal being settled.

5. **Legacy table status vocabulary differs.** `withdrawals.status` uses a mix of lowercase and uppercase labels, while `onchain_withdrawals.status` primarily uses uppercase labels. This increases the risk of inconsistent filtering or state mapping across callers.

6. **The refund authorization boundary remains unresolved.** Step 36O established that `process_failed_withdrawal` trusts the caller-supplied `p_is_verified_unbroadcast` boolean and does not independently verify broadcast absence. The pre-broadcast worker path still passes `true`; the attempted code change was blocked by safety checks, so it was not applied.

## Recommended next safe implementation sequence

1. Design a database-enforced settlement function that locks the canonical row, requires a valid stored non-empty hash, compares the supplied hash to the stored hash, and permits settlement only from explicitly approved states. Keep the operation idempotent and preserve funds on any mismatch.
2. Design a transaction-safe reconciliation strategy for the paired legacy row; do not add a foreign key or change statuses until existing mismatches and callers are inventoried.
3. Replace the caller-controlled refund Boolean with a database-controlled authorization path. Unknown or ambiguous broadcast outcomes must preserve the reservation pending reconciliation.
4. Add regression tests for hash mismatch, missing hash, duplicate settlement, concurrent settlement, mismatched legacy row, and ambiguous broadcast.

## Production readiness

Withdrawals are **not production-ready yet**. This step identified database guardrail gaps but did not change them. The previous worker changes improve fail-closed handling and defer settlement until confirmation, but the settlement RPC hash-binding gap and pre-broadcast refund authorization gap remain blockers.
