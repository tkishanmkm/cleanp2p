# Step 32 — Deposit Cutover Status and Endpoint Recheck

Date: 2026-10-14
Repository: tkishanmkm/cleanp2p
Branch: fix/phase-01-fail-closed-deposit-webhooks

## Verified status messaging

- `src/app/api/workers/deposit-worker/route.ts` requires worker authentication and returns `success: false`, `DEPOSIT_CREDITING_PAUSED`, `depositsPaused: true`, HTTP 503. Its message explicitly says independent chain verification is pending and no deposits were credited.
- `src/app/api/cron/indexer/route.ts` also authenticates the caller and returns paused status with HTTP 503; it does not report indexing success.
- `tests/deposit-worker-reports-paused.test.ts` contains assertions for both routes and the fail-closed job. The test is present but was not executed.
- The stale “completed via canonical process_deposit_atomic” response discussed in prior planning is already corrected in this draft branch; no duplicate edit was needed.

## Additional endpoint recheck

- `src/app/api/wallet/deposit/route.ts`: POST returns HTTP 410 and does not credit caller-supplied transaction/amount data.
- `src/app/api/webhooks/deposits/route.ts`: aliases the retired `/api/webhooks/deposit` route; it does not introduce a separate credit implementation.
- `src/app/api/verify-deposit-recovery/route.ts`: GET returns HTTP 410 with `Cache-Control: no-store`; no admin database query is performed.
- `src/app/api/wallet/deposit-address/route.ts`: requires a Supabase Auth user (Bearer token or cookie) before deriving addresses; unauthenticated requests receive HTTP 401.
- `src/app/api/wallet/deposit-addresses/route.ts`: likewise requires an authenticated user before deriving/returning address data. It returns profile/record metadata for that authenticated user; minimize the response schema as part of a separate privacy review.
- `src/app/api/deposit-address/route.ts` aliases the wallet-address handler.

## Caller inventory status — not complete

The recursive draft-branch tree contains 747 files overall. The API, jobs, library, Supabase migrations/functions, and tests scope contains 386 TypeScript/JavaScript/SQL files. An attempt to fetch many file blobs in a single tool run exceeded the connector's tool-call limit, so a complete content-level repository-wide RPC search was not completed. GitHub code search is indexed against the default branch and is not a reliable substitute for the draft branch. Missing search results do not prove no caller exists.

Still unverified:
- Every direct/dynamic RPC call in all source files and tests.
- All SQL function bodies, triggers, and dependencies across every migration and deployed schema.
- Edge Function invocations, database webhooks, external schedulers, and callers outside GitHub.
- Whether any legacy privileged credit function is invoked by another service.

## Safety / next action

No code, SQL, grants, financial rows, runtime configuration, merge, or deployment was changed in this step. Deposit crediting remains paused in the draft branch. Do not resume deposits or retire legacy RPCs until the caller inventory and verifier-owned evidence design are reviewed. Focused tests, full suite, typecheck, lint, and build remain unexecuted.
