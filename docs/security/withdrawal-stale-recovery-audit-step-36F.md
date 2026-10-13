# Withdrawal stale-record recovery audit — Step 36F

Date: 2026-10-14
Repository: `tkishanmkm/cleanp2p`
Branch: `fix/retire-unverified-deposit-entrypoints`

## Scope and audit result

Reviewed the current `src/jobs/withdrawalWorker.ts` implementation for stale `PROCESSING` records, missing transaction hashes, chain reconciliation, and consistency between `onchain_withdrawals` and `withdrawals`.

### Findings

1. **Stale `PROCESSING` rows with no transaction hash are not recovered by the confirmation loop.** `checkSubmittedWithdrawals()` filters to non-null `tx_hash`. It cannot reconcile a transaction that was accepted by a node but whose hash failed to persist.
2. **No safe stale-claim lease is visible in the worker.** Queue claiming transitions records to `PROCESSING`, but this file does not show a lease/heartbeat or a bounded recovery mechanism for abandoned claims.
3. **EVM nonce evidence is not yet used to reconcile hashless broadcasts.** The worker allocates a database nonce, but on persistence failure the catch path sets `AMBIGUOUS_BROADCAST`; it does not query the chain by sender + nonce before any retry. A retry must not be implemented until that reconciliation is transactionally safe.
4. **The paired `withdrawals` update is unchecked after broadcast.** The `onchain_withdrawals` hash/status write checks its error, but the corresponding legacy `withdrawals` update does not inspect the returned error. This can leave the two records inconsistent.
5. **Confirmation reconciliation needs database-side binding checks.** The worker passes `w.id` and `w.tx_hash` to `complete_onchain_withdrawal`, but the function definition and live signature could not be safely retrieved in this run. Do not assume the database validates stored-hash equality, allowed state transitions, or idempotency until verified.
6. **Ambiguous records are repeatedly polled.** `AMBIGUOUS_BROADCAST` with a non-null hash is included in the same 30-row confirmation query. This may be useful for reconciliation, but the query has no explicit ordering and can starve older records if the first 30 rows are repeatedly returned.

## Safe decision

No production SQL, withdrawal rows, balances, or ledger records were changed. No automatic retry/refund logic was added: the available evidence does not establish the live schema constraints or the database settlement function's transaction-binding guarantees. A speculative recovery could create a duplicate payout or release reserved funds incorrectly.

## Required next actions

1. Inspect the live definitions of `claim_pending_withdrawals` and `complete_onchain_withdrawal`, table constraints, and current stale-row counts in the production project.
2. Reconcile hashless EVM records against sender + stored nonce and chain/mempool evidence; for TRON, use the provider's transaction/broadcast evidence. Do not re-dispatch while the outcome remains uncertain.
3. Add a bounded lease/recovery state transition that cannot reclaim a potentially broadcast withdrawal for dispatch.
4. Make both status/hash updates checked and recoverable, preferably with a database transaction/RPC that updates the paired records atomically.
5. Add ordered/aged polling and explicit handling for repeated ambiguous records.
6. Test failure injection for node timeout-after-acceptance, DB outage after broadcast, duplicate worker claims, and confirmation-worker retries.

## Verification limits

The GitHub worker file was reviewed. Attempts to query production schema/function definitions were blocked by the tool safety layer in this run, so live database state and function behavior remain unverified. Build, typecheck, and tests were not run. This step is an audit report, not a production-readiness certification.
