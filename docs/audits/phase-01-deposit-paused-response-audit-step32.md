# Step 32 — Deposit-Paused Response Consistency Audit

Date: 2026-10-14
Repository: tkishanmkm/cleanp2p
Branch: fix/phase-01-fail-closed-deposit-webhooks

## Scope

Read-only inspection of the deposit worker, cron indexer, confirmation route, legacy direct-deposit route, and their source assertion tests. No production data, database settings, grants, or financial records were accessed or changed.

## Findings

1. `src/app/api/workers/deposit-worker/route.ts` authenticates the worker before running the disabled ingestion function. It returns `DEPOSIT_CREDITING_PAUSED`, `depositsPaused: true`, and HTTP 503 with explicit text that no deposits were credited.
2. `src/app/api/cron/indexer/route.ts` uses the worker-auth helper and returns the same paused code/flag with HTTP 503. Its message explicitly says no deposits were credited.
3. `src/jobs/depositIngestion.ts` returns zero detected/credited results and makes no credit RPC call in the current active implementation. Monitored-address sets are empty.
4. `src/app/api/workers/confirmations/route.ts` authenticates the worker and labels the output `VERIFICATION_REQUIRED`; the response explicitly states that confirmation diagnostics are not deposit verification and that crediting is disabled.
5. `src/app/api/wallet/deposit/route.ts` returns HTTP 410 because the legacy caller-supplied deposit endpoint does not independently verify chain transactions.
6. `tests/deposit-worker-reports-paused.test.ts` already contains source assertions for both worker and cron paused responses, including HTTP 503 and the absence of stale “completed via canonical process_deposit_atomic” text. `tests/confirmation-route-reports-diagnostic-only.test.ts` checks that confirmation diagnostics do not call the credit RPC.

## Result

The previously identified stale worker-success wording is already corrected on the current draft branch; no additional route code change was necessary in this step. Source-level assertions exist, but they were not executed here. Static source checks alone do not prove runtime behavior.

## Remaining critical work

- Finish a full content scan of all 714 TypeScript/TSX/JavaScript/SQL files in the branch and enumerate direct/dynamic RPC invocations, SQL function-to-function calls, triggers, Edge Functions and scheduled tasks. The tree inventory identified many candidate wallet/worker routes and migrations; the full text scan is not yet complete.
- Inspect deployed catalog dependencies and effective privileges for every unsafe legacy credit function without reading financial rows.
- Implement and test verifier-owned evidence records and an evidence-ID-only atomic credit function in a staging environment before any production cutover.
- Establish provider/scheduler migration plans before deploying retired webhook endpoints; deposits remain intentionally paused.

## Safety

No production SQL, grants, financial rows, runtime configuration, merge or deployment changed. Not production-ready.
