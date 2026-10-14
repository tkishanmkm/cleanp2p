# Withdrawal Settlement Guard Design Audit — Step 36Q

Date: 2026-10-14  
Scope: read-only inspection of the live production definition and grants for `public.complete_onchain_withdrawal`.

## Result

**Audit/design only. No production schema, privileges, financial rows, or application code changed. No tests were run.** A read-only status-count query returned no rows through the connected query interface; this is treated as inconclusive, not as evidence that the table is empty.

## Critical findings in the live settlement function

1. **Stored hash is not required to match.** The function normalizes the supplied hash, but on nonterminal rows it does not compare it with the row's persisted `tx_hash`. It then writes the supplied hash into the withdrawal row. This is a settlement authorization gap: a privileged caller can supply a different hash.

2. **Hashless terminal rows can be accepted as already complete.** For `CONFIRMED`/`COMPLETED`, the function checks for mismatch only when the stored hash is non-null. A terminal row with no stored hash can therefore return `success: true` for an arbitrary non-empty supplied hash.

3. **Legacy-table fallback is unsafe/incomplete.** If no row is found in `onchain_withdrawals`, the function selects a row from `withdrawals`, but later still updates `onchain_withdrawals` by ID and also updates `withdrawals`. This creates a path where the canonical row may not exist while the function continues through wallet liability and ledger logic. It must be explicitly designed rather than implicitly falling back.

4. **State transitions are too permissive.** The function blocks `failed`, `cancelled`, and `rejected`, but otherwise does not restrict settlement to a small approved set of states such as a confirmed broadcast with verified hash. Unknown, pending, or otherwise unexpected states can reach settlement.

5. **Dual-table update is not guarded by row counts.** The updates to `onchain_withdrawals` and `withdrawals` do not check that exactly one row was updated. The function should not report success when expected persistence is missing. Any solution must preserve transaction atomicity and avoid duplicate liability deductions/ledger entries.

6. **Hash uniqueness is useful but not sufficient.** The function checks that the normalized hash is not already associated with a different on-chain withdrawal. It still needs to bind the hash to this withdrawal's persisted broadcast evidence.

7. **Access is restricted to privileged callers.** Current ACL inspection showed execution denied for `anon` and `authenticated`, allowed for `service_role`. This reduces direct public exposure but does not replace validation inside a privileged financial RPC.

## Recommended settlement guard contract

Before implementing a migration, inventory current callers, schemas, and historical row consistency. Then implement and test a new/updated transaction-bound settlement path that:

- locks the canonical `onchain_withdrawals` row and rejects missing rows rather than silently falling back;
- requires a non-empty stored broadcast hash and exact normalized equality with the supplied hash;
- only settles from explicit allowed states after chain confirmation is verified by the worker;
- treats terminal retries as idempotent only when the persisted hash exactly matches;
- validates the matching legacy row before changing any wallet liability;
- updates expected records in one database transaction and verifies affected row counts;
- preserves current ledger idempotency and ensures a retry cannot deduct `in_withdrawal` twice;
- fails closed on any mismatch and leaves funds reserved for reconciliation.

The refund path must be handled separately: do not treat caller-provided `p_is_verified_unbroadcast` as authoritative evidence.

## Production readiness

**Withdrawals are not production-ready yet.** This audit confirmed high-severity settlement authorization gaps in the live function. No fix was applied in this step. A replacement should not be deployed until regression tests cover wrong/missing hashes, legacy-only rows, unexpected states, duplicate settlement, concurrent calls, and inconsistent paired records.
