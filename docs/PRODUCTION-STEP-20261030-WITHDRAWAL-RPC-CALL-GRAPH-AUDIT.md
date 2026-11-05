# Paxones Production Audit — Withdrawal RPC Call Graph (2026-10-30)

## Scope and limitations
Static inspection of application routes, worker jobs, and migration history. This is not proof of live database function definitions, grants, deployed code, or runtime reachability. No production database was queried or modified.

## Call sites found
The static inventory found 16 calls to the selected withdrawal RPCs:

- `src/app/api/admin/withdrawals/approve/route.ts` calls `approve_withdrawal(p_withdrawal_id, p_admin_id)`.
- `src/app/api/admin/withdrawals/review/route.ts` calls `approve_withdrawal(p_withdrawal_id, p_admin_id)` and `admin_reject_withdrawal(p_withdrawal_id, p_admin_id, p_rejection_reason)`.
- `src/app/api/withdraw/refund/route.ts` calls `process_failed_withdrawal(p_withdrawal_id, p_error_reason)`.
- `src/jobs/withdrawalWorker.ts` calls `claim_pending_withdrawals(p_owner_token, p_limit)`, `record_withdrawal_broadcast(p_withdrawal_id, p_tx_hash, p_owner_token)`, `record_ambiguous_withdrawal_broadcast(...)`, and `process_failed_withdrawal(...)` for pre-broadcast failure and verified chain-revert paths.
- `src/jobs/withdrawalWorkerLease.ts` calls acquire, renew, and release lease RPCs with an owner token.
- `src/lib/services/withdrawalService.ts` calls `lookup_withdrawal_idempotency_replay(...)` and `request_withdrawal_idempotent(...)`.

## Contract observations

1. The six-argument `process_failed_withdrawal` function declares defaults for the gas amount, gas asset, verified-revert flag, and legacy unbroadcast flag. Therefore the refund route's two named arguments are intended to resolve to that function. This still depends on the live catalog not containing a competing overload with overlapping defaults.
2. The worker passes `p_is_verified_revert: true` only in the chain-revert branch. The function body requires a persisted transaction hash and a broadcast-capable state before refunding this case.
3. Pre-broadcast worker refunds do not claim that a client-supplied unbroadcast flag proves safety; the database must prove the no-hash, pre-broadcast state.
4. Queue claim and broadcast recorder calls pass `p_owner_token`; the call sites align with the newer owner-token migration contracts at a static argument-name level.
5. `admin/withdrawals/review` expects `rpcData.success` directly, while the dedicated approval route also handles a JSON-string result. The SQL migrations declare `approve_withdrawal` as JSONB in the audited source history, so the object expectation is consistent with the source contract; deployed return type remains unverified.

## Test result
- `tests/withdrawal-rpc-call-graph.test.mjs`: 4 passed, 0 failed.
- `git diff --check` for the new audit artifacts: passed.
- Static call graph output: `docs/PRODUCTION-STEP-20261030-WITHDRAWAL-RPC-CALL-GRAPH.json`.

## Remaining blockers
- Supabase CLI has no access token in the local environment; live catalog/ACL inventory is unavailable.
- Current deployed function overloads, owners, `SECURITY DEFINER` settings, `search_path`, and effective grants are unverified.
- Withdrawal idempotency objects/schema previously observed as mismatched still require current confirmation.
- No schema-matched disposable PostgreSQL replay/concurrency test has been performed.

## Safety
No production query, migration, withdrawal, commit, push, deployment, or GitHub Actions minutes used. Existing working-tree changes preserved.

**Status: Call-site mapping completed. Withdrawal production readiness remains blocked pending deployed catalog verification and isolated database tests.**