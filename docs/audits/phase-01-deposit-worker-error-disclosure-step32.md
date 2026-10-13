# Step 32 — Deposit Worker Error Disclosure Hardening

Date: 2026-10-14
Branch: fix/phase-01-fail-closed-deposit-webhooks

## Change made

The authenticated `POST /api/workers/deposit-worker` route no longer returns `error.message` to the caller on unexpected exceptions. It now returns a generic HTTP 500 response with stable code `DEPOSIT_WORKER_FAILED`. The detailed error remains in server logs for operator investigation.

The paused response remains explicit: `success: false`, `DEPOSIT_CREDITING_PAUSED`, `depositsPaused: true`, and HTTP 503. This avoids suggesting deposit processing succeeded while crediting is disabled.

## Test coverage added

Updated `tests/deposit-worker-reports-paused.test.ts` to assert the stable failure code is present and the route does not return `error.message`. Existing assertions also check that the route reports the paused state and that ingestion contains no call to `process_deposit_atomic`.

## Validation and limitations

- Source files were read back from the draft branch before editing.
- Changes are committed on the draft PR branch only.
- The test has not been executed in a local runtime; source assertions are not a substitute for running tests.
- No production SQL, grants, financial rows, secrets, merge, or deployment changed.
- The broader exhaustive caller inventory for legacy credit RPCs is still incomplete. The previous caller-map report explicitly records that limitation.
- Deposits remain paused pending independent exact-event verification and an evidence-backed database credit boundary.

## Next step

Complete the branch-wide caller inventory using a local clone/repository search and database catalog dependency inspection, then design and test the evidence-bound credit RPC. Do not revoke legacy functions until callers and environment migration order are understood.
