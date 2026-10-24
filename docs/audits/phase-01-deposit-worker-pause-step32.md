# Step 32 — Deposit Worker Pause Semantics and Repository Inventory

Date: 2026-10-14
Repository: tkishanmkm/cleanp2p
Branch: fix/phase-01-fail-closed-deposit-webhooks

## Changes made

1. Updated `src/app/api/workers/deposit-worker/route.ts` so the endpoint no longer claims the canonical credit RPC completed. When invoked, it returns HTTP 503 with code `DEPOSIT_CREDITING_PAUSED`, `depositsPaused: true`, and an explicit message that no deposits were credited.
2. Added `tests/deposit-worker-reports-paused.test.ts` with source assertions that check the pause status, HTTP status, stale-message removal and the ingestion job's fail-closed behavior.
3. Added npm script `test:deposit-worker-reports-paused`.

The test was added but not executed: the connected GitHub file tools can edit source but do not provide a local checkout/runtime here. Do not interpret source assertions as passing runtime tests.

## Repository tree inventory

Fetched the complete Git tree for this branch (GitHub reported `truncated=false`) and counted 739 files with source/config extensions among TypeScript, TSX, JavaScript, JSX, SQL and JSON:
- 576 under `src/`
- 114 under `supabase/` or migration-related paths
- Key deposit routes, worker routes, jobs, wallet transfer endpoints, cron routes and historical migrations were enumerated for follow-up.

This is a path inventory, not a complete textual search of every file. GitHub's code search is indexed against the default branch and did not provide reliable draft-branch matches, so the exhaustive RPC caller map remains open. Do not revoke legacy SQL functions based on this partial inventory.

## Additional findings from spot checks

- `src/app/api/wallet/deposit/route.ts` returns HTTP 410 and does not accept a caller-supplied transaction as a credit instruction.
- `src/app/api/webhooks/deposits/route.ts` re-exports the retired generic webhook route.
- `src/app/api/workers/deposit-sweep/route.ts` retains an authenticated GET path to `runDepositSweeper()`; its POST path is retired. Sweeping is separate from deposit crediting and needs its own review for destination validation, durable pre-broadcast persistence, idempotency, reorg/retry safety and secret handling.
- `src/app/api/wallet/transfer/route.ts` contains authentication, platform-guard, withdrawal-approval and sender restriction checks, but it was not fully audited in this step.

## Next actions

1. Perform a branch-wide content scan of all 739 candidate files for each unsafe RPC name, dynamic `.rpc()` construction, SQL function calls, triggers and edge functions.
2. Inspect deployed `pg_proc`, `pg_depend`, triggers and effective ACLs in read-only mode; compare to migration history. Keep production financial rows untouched.
3. Build a verifier-owned evidence table and credit function only after schema/chain proof design and staging tests. The credit function must consume a unique verified-evidence ID, not user/provider-supplied amount or confirmations.
4. Separately audit sweeper, withdrawals and user transfers before enabling any wallet flow.

## Safety status

No production SQL, grants, financial rows, config, merge or deployment changed. Deposits remain paused in this draft. Runtime test execution, typecheck, lint and build are not verified. This is not production-ready.
