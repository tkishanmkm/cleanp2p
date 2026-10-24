# Step 32 — Destructive Deposit Test Isolation

Date: 2026-10-14
Repository: tkishanmkm/cleanp2p
Branch: fix/phase-01-fail-closed-deposit-webhooks

## Finding

The pre-existing `tests/canonical-deposit-cutover.test.ts` loaded `.env.local`, selected `SUPABASE_SERVICE_ROLE_KEY` or the public anon key, and performed `upsert` writes plus calls to `process_deposit_atomic`. Running this suite with application environment variables could therefore mutate a non-test Supabase project and attempt real financial credits. This is a test safety issue, independent of whether the current deposit worker is paused.

## Changes made on the draft branch

- Removed automatic loading of `.env.local` from the destructive cutover test.
- Removed fallback to app/service-role or public anon credentials.
- Require explicit `ALLOW_DESTRUCTIVE_DEPOSIT_CUTOVER_TESTS=true`.
- Require dedicated `SUPABASE_TEST_URL` and `SUPABASE_TEST_SERVICE_ROLE_KEY`.
- Refuse to execute unless the configured URL hostname is `localhost`, `127.0.0.1`, or `::1`.
- Added `tests/deposit-cutover-test-safety.test.ts` with source assertions.
- Added npm script `test:deposit-cutover-test-safety`.

Commits:
- `35d193ca82664b0b4ebff8cbb1af1d7a2f79fe19` — isolate destructive test configuration.
- `c8d96d5f6457da2c1080f9a3162b50c530dc33b7` — add safety assertions.
- `92c861b82f895a2713ed446dfaf5cc9c24f22940` — add npm script.

## Verification and limits

- Source was fetched from the draft branch before modification; updates were committed through GitHub.
- Automated tests have not been executed in this environment. The new safety test is a static source test, not a substitute for running the full suite.
- This protects against accidental remote test execution by this script, but local-host configuration alone does not prove the local database is disposable. Use a fresh isolated local Supabase instance and synthetic data only.
- The caller inventory for every privileged deposit RPC is still incomplete; branch-wide dependency and external scheduler mapping remains required.

## Safety status

No production SQL, grants, financial rows, project configuration, merge, or deployment changed. Deposit crediting remains paused in the draft. Production readiness is not established.
