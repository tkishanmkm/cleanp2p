# Step 32 — Privileged Worker Credential Fallback Hardening

Date: 2026-10-14
Branch: `fix/phase-01-fail-closed-deposit-webhooks`
Scope: source-only hardening in the draft PR. No production database or secrets were accessed or changed.

## Change made

Updated:
- `src/jobs/depositIngestion.ts`
- `src/jobs/confirmationsWorker.ts`

Both worker modules previously fell back from `SUPABASE_SERVICE_ROLE_KEY` to `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The deposit ingestion module also had a hard-coded project URL fallback. These patterns can hide missing privileged configuration and cause a worker to run with an unintended privilege level or target.

They now:
- use `SUPABASE_SERVICE_ROLE_KEY` only for the worker client;
- prefer configured `SUPABASE_URL`, then `NEXT_PUBLIC_SUPABASE_URL`;
- use a placeholder URL/key when required configuration is missing, so the fallback does not silently use an anon key or a hard-coded production project;
- retain the existing fail-closed deposit behavior (no scanner or credit RPC calls).

Added `tests/privileged-worker-credentials.test.ts` with source assertions and package script `test:privileged-worker-credentials`.

## Validation

The source and package changes were committed to the draft branch. The new test has **not been executed** in this environment. Typecheck, lint, build and full test suite remain unrun. The test uses static source assertions; it does not replace runtime configuration tests.

## Remaining critical work

This is not the evidence-backed credit boundary and does not resolve the unsafe legacy SQL functions identified in Step 30. The complete caller inventory remains unfinished because branch-scoped search/dependency inspection is not yet exhaustive. Deposits must remain paused. No production SQL, grants, financial rows, secrets, merge or deployment changed.
