# Step 35R — Deposit entry-point and worker-status audit

Status: reviewed eight deposit-related API routes plus the shared ingestion cycle on the proposal branch. Two status-reporting defects were corrected in code. No tests/build were run and no deployment or database change was made.

## Audited entry points

- `src/app/api/cron/indexer/route.ts`
- `src/app/api/workers/deposit-worker/route.ts`
- `src/app/api/verify-tron-only/route.ts`
- `src/app/api/verify-deposit-recovery/route.ts`
- `src/app/api/webhooks/blockcypher/route.ts`
- `src/app/api/webhooks/litecoin/route.ts`
- `src/app/api/webhooks/alchemy/route.ts`
- `src/app/api/internal/chain-ingest/route.ts`

The six diagnostic/webhook/internal handlers above return HTTP 410 and do not perform deposit credit in their current branch contents. This only verifies these exact handlers on this branch, not deployed runtime behavior or other API routes.

## Findings and fixes

### 1. Cron indexer falsely reported success

Before the fix, the route always returned `success: true` and HTTP 200 after `runDepositIngestion()`, even when its own result reported errors. This could cause monitoring/schedulers to mistake a failed or fail-closed deposit cycle for a successful run.

Fix: derive success from `indexerResult.ok` and `errorCount`; return HTTP 500 when the cycle reports errors; include per-network error details in the authenticated response.

Commit: `3b373a5a8482943a9fe93f8af0c580890724222d`

### 2. Deposit worker message was stale and always reported success

The worker response claimed pending credit was limited to a verified EVM path, although Step 35Q had disabled that credit call as well. It also returned success regardless of ingestion errors.

Fix: return the actual cycle status/error count and accurately state that automatic credit remains fail-closed pending a validated trust boundary. Return HTTP 500 when the cycle reports errors.

Commit: `b22635dd9feba5902bbb2e023d96741fb7536afe`

## Important remaining risks

- Current fail-closed behavior may leave legitimate deposits pending; operational reconciliation and customer support procedures are required.
- A complete repository-wide search of every database credit RPC caller and every route has not been proven by this eight-file review.
- These changes are not runtime-tested; monitoring systems may need to handle HTTP 500 and retries without creating harmful duplicate side effects.
- No evidence yet establishes an independently protected credit verifier, replay protection, concurrency safety, or production/staging schema parity.
- No tests, typecheck, build, CI run, SQL, secret, database, or deployment was changed or verified by this step.

## Verification performed

Both changed route files were read back from the proposal branch after committing. Their new status logic and messages were confirmed. This is source verification only, not proof of successful compilation or runtime behavior.

## Result

Deposit entry-point source review: eight named handlers checked.
Status-reporting defects: two fixed in code.
Deposit production readiness: **NO**.
