# Paxones Production Audit — Withdrawal Financial Consistency (2026-10-30)

## Scope
Static audit of withdrawal request idempotency, paired `withdrawals` / `onchain_withdrawals` state, broadcast ownership, refund authorization, and retired dispatch routes. This step used the existing local repository and did not contact or mutate production.

## Findings

### Critical release blockers remain
1. **Live request RPC/schema mismatch was previously observed read-only.** The production `request_withdrawal(uuid,text,text,numeric,numeric,text,numeric)` definition omitted `onchain_withdrawals.idempotency_key`, despite that column being `NOT NULL` with no default and a unique index. A normal request is therefore expected to fail transactionally at that insert. See `docs/PRODUCTION-STEP-20261026-WITHDRAWAL-INSERT-CONTRACT-BLOCKER.md`.
2. **Production idempotency contract drift was previously observed read-only.** Production did not have `withdrawal_idempotency_keys`, `request_withdrawal_idempotent(...)`, or `lookup_withdrawal_idempotency_replay(...)`, while the application requires the replay lookup and idempotent reservation path. Do not bypass idempotency or apply migrations blindly. See `docs/PRODUCTION-STEP-20261026-WITHDRAWAL-IDEMPOTENCY-DRIFT.md`.
3. **No schema-faithful disposable PostgreSQL integration test has been run.** Static tests cannot establish atomic rollback, concurrency behavior, actual installed function definitions, or live grants.

### Controls supported by local source/static contracts
- Withdrawal requests require a caller-provided idempotency key; replay lookup occurs before mutable pending-approval and rolling-limit checks.
- An unavailable replay lookup fails closed rather than falling back to a non-idempotent reservation RPC.
- The candidate repair migration checks for the expected RPC signature, required NOT NULL column, and known function-body shape; it refuses to patch unexpected drift.
- Broadcast state writes are designed to lock both paired records, preserve immutable transaction hashes, and record uncertain outcomes as `AMBIGUOUS_BROADCAST` rather than treating uncertainty as failure.
- Refund hardening requires explicit verified pre-broadcast failure or verified on-chain revert, exact locked-liability coverage, and consistent paired records. A caller-supplied unbroadcast flag cannot authorize a refund.
- Queue claims and broadcast writes use database-backed lease/owner-token fencing in the local candidate migration; stale outcomes are treated conservatively.
- Legacy direct-dispatch endpoints are disabled; the scheduled canonical worker is the intended dispatch path.

## Verification
Selected static test batches:
- Request idempotency, replay lookup, schema insert-contract candidate, and worker database fencing: **9 passed, 0 failed**.
- Refund broadcast-safety, forward hardening, lock order, paired-record dispatch, direct-payout safety, and legacy endpoint containment: **20 passed, 0 failed**.
- `git diff --check` for the candidate insert-contract migration and its regression test: **passed**.

These are source-level/static checks, not a live PostgreSQL test. The candidate migration is not proven safe to deploy merely because the static checks pass.

## Required release gate
1. Reconcile production migration history and capture authoritative definitions, columns, indexes, and grants read-only.
2. Restore a schema-matched disposable PostgreSQL environment and test the insert-contract patch plus idempotency wrapper/lookup together.
3. Test same-key concurrent requests, same-key/different-intent conflicts, lost-response retries, transaction rollback, and exact wallet/ledger liability accounting.
4. Verify refunds against pre-broadcast failures and explicit chain reverts; confirm ambiguous or broadcasted withdrawals cannot be refunded without verified chain failure.
5. Only after these gates pass, prepare a reviewed migration plan. Do not hot-edit production or deploy this candidate without explicit approval.

## Safety
- No withdrawal submitted.
- No production database query or mutation in this step.
- No migration applied.
- No commit, push, or deployment.
- No GitHub Actions minutes used.
- Existing working-tree changes preserved.

**Status: Withdrawal financial consistency audit completed at the static-source level. Production withdrawal readiness remains BLOCKED / UNVERIFIED.**