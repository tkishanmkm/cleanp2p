# Step 32 — Deposit Sweep Worker Error Disclosure

Date: 2026-10-14
Branch: `fix/phase-01-fail-closed-deposit-webhooks`
Scope: focused audit and draft-branch remediation of `src/app/api/workers/deposit-sweep/route.ts`.

## Finding

The authenticated GET handler returned `err.message` to the HTTP caller on unexpected failures. Errors from RPCs, the database driver, or chain/provider libraries can contain internal implementation details. The route is a privileged worker endpoint, so those details should remain in server-side logs.

## Change made

- The catch block now accepts `unknown`, logs the original error server-side, and returns only `{ error: 'Internal server error' }` with HTTP 500.
- Unauthorized requests still return HTTP 401 before the sweeper module is imported.
- The legacy POST direct-broadcast endpoint remains retired with HTTP 410.
- Added `tests/deposit-sweep-error-redaction.test.ts` with source assertions for auth ordering, generic error response, absence of exception-message leakage, and legacy endpoint retirement.
- Registered `npm run test:deposit-sweep-error-redaction` in `package.json`.

## Validation

The test was added but not executed in this environment. No runtime test, typecheck, lint, or build result is claimed.

## Deposit credit caller-map status

The earlier Step 31 report remains a partial inventory. The repository tree is available, but the tool's per-execution call limit prevented a complete content scan of all candidate source files in one pass. GitHub code search also did not return usable results for the target RPC names. Therefore this step does **not** claim that every caller of legacy deposit-credit functions has been located. No legacy database functions were revoked or modified.

## Safety

Only the draft GitHub branch was changed. No production SQL, grants, financial rows, secrets, merge, or deployment was changed. Deposits remain paused pending a verifier-owned evidence boundary.
