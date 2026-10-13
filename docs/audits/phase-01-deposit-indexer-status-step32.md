# Step 32 — Paused Deposit Indexer Status Clarity

Date: 2026-10-14
Branch: `fix/phase-01-fail-closed-deposit-webhooks`
Scope: small application-level correctness fix and static assertion. No database or production changes.

## Findings

- The authenticated deposit-worker route already returns HTTP 503 with `DEPOSIT_CREDITING_PAUSED`, `depositsPaused: true`, and an explicit no-credit message.
- The cron indexer route also returns HTTP 503 with `DEPOSIT_CREDITING_PAUSED`, but its log said “Triggered successfully,” which could be misread operationally as a successful indexing run even though indexing is intentionally paused.
- The repository tree contains many TypeScript and SQL files. GitHub code search returned no matches for the credit RPC names and is not reliable for the draft branch. An exhaustive repository-wide RPC caller map is therefore still incomplete; no absence-of-callers conclusion is made.

## Change made

- Updated `src/app/api/cron/indexer/route.ts` to log: “Authenticated request received; indexing remains paused at …” rather than “Triggered successfully”.
- Updated `tests/deposit-worker-reports-paused.test.ts` with assertions that the misleading success phrase is absent and the explicit paused-state log is present.

Commits:
- `7c126be998108af1c410ed28bb2d4b6822c90e5d` — clarify paused indexer status.
- `3d0e033f506d608da2a4f9d87fc15a64823a1ea6` — assert paused indexer status.

## Validation and limits

The test was edited but not executed in this environment. No full test suite, typecheck, lint or build was run. No production SQL, grants, financial rows, configuration, merge or deployment was changed.

## Remaining blocker

Before any deposit reactivation, complete an exhaustive caller/dependency inventory for every legacy credit function, then design and test a verifier-owned evidence boundary. Deposits remain intentionally paused and the platform is not certified production-ready.
