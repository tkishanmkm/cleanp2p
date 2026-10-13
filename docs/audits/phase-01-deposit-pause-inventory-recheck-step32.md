# Step 32 — Deposit Pause Status and Repository Inventory Recheck

Date: 2026-10-14
Repository: tkishanmkm/cleanp2p
Branch: fix/phase-01-fail-closed-deposit-webhooks

## Scope

Rechecked the full Git tree for this branch, the deposit worker and cron indexer route, the ingestion job, the legacy user deposit endpoint, the webhook alias, and the existing pause/cutover safety tests. This was source-only inspection; no test process, production SQL, or financial rows were run/read.

## Findings

1. The branch tree contains 744 files with TypeScript/TSX/JavaScript/SQL/JSON extensions. The recursive Git tree response was not truncated.
2. `src/app/api/workers/deposit-worker/route.ts` now reports `success: false`, `code: DEPOSIT_CREDITING_PAUSED`, `depositsPaused: true`, and HTTP 503. Its message explicitly states no deposits were credited.
3. `src/app/api/cron/indexer/route.ts` likewise returns the paused code and HTTP 503. It does not report successful indexing.
4. `src/jobs/depositIngestion.ts` returns zero detected/credited results, returns empty monitored-address sets, and contains no active `process_deposit_atomic` RPC call in the inspected file.
5. `src/app/api/wallet/deposit/route.ts` is retired with HTTP 410; `src/app/api/webhooks/deposits/route.ts` aliases that retired route.
6. Existing `tests/deposit-worker-reports-paused.test.ts` includes assertions for both worker and cron indexer paused status and absence of the misleading old success message. `tests/deposit-cutover-test-safety.test.ts` asserts destructive cutover tests require explicit opt-in, dedicated test credentials, and a localhost-only database host.
7. GitHub code search produced no hits for the legacy credit RPC names. That search indexes the default branch, so its empty results cannot establish that the draft branch has no callers. No exhaustive caller-free claim is made.

## Caller-inventory status

Known active deposit ingestion and webhook routes inspected in Steps 27–32 are fail-closed. This does not establish that every privileged SQL function is unused: the full branch-wide RPC caller scan, SQL dependency/trigger review, and external scheduler inventory remain open. Do not revoke legacy functions until those are completed.

## Validation

No runtime tests were run in this step. Source assertions exist but remain unexecuted in this environment. Typecheck, lint, build, and staging adversarial tests remain outstanding.

## Safety status

No application code change was necessary for the paused-status issue because the current branch already contains the correction and assertions. No production SQL, grants, financial rows, config, merge, or deployment changed. Deposit crediting remains paused; platform is not yet production-ready.
