# Step 32 — Paused-status endpoint review and caller-inventory limitations

Date: 2026-10-14
Branch: fix/phase-01-fail-closed-deposit-webhooks

## Verified in current branch

Read directly from the branch:
- `src/app/api/workers/deposit-worker/route.ts` returns HTTP 503 with `success: false`, `code: DEPOSIT_CREDITING_PAUSED`, `depositsPaused: true`, and an explicit message that no deposits were credited.
- `src/app/api/cron/indexer/route.ts` likewise returns HTTP 503 and explicitly says indexing is paused and no deposits were credited.
- `tests/deposit-worker-reports-paused.test.ts` includes static assertions for both routes and verifies the ingestion module does not invoke `process_deposit_atomic`.
- `src/jobs/depositIngestion.ts` returns zero detected/credited results and does not query monitored addresses or invoke a credit RPC.

The potentially stale worker/indexer response wording flagged in the Step 31 recommendation has already been corrected in this branch. No additional code change was necessary for that item.

## High-risk historical migration confirmed

`supabase/migrations/20260910000001_add_process_user_deposit_rpc.sql` contains a SECURITY DEFINER `process_user_deposit(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT)` overload that:
- accepts the user, destination address, asset, chain, amount, and transaction hash from the caller;
- directly updates wallet balances and writes deposit/on-chain/processed-deposit/ledger records;
- sets a completed/confirmed state and a fixed confirmation count without proving a canonical chain event;
- grants EXECUTE to `authenticated`, `anon`, and `service_role` in that historical migration.

A later hardening migration reportedly revokes these grants in the deployed environment (see Step 29/30 notes), but the old migration remains dangerous if a new environment applies it without the corresponding hardening migration. Fresh-environment migration ordering and effective privileges must be validated before release.

## Caller inventory status

This is not yet an exhaustive repository-wide caller map. The GitHub code-search integration searches the default branch, and the recursive tree response could not be parsed completely through the current connector response. Therefore this step does not claim that every application caller, dynamic RPC invocation, SQL trigger/function, Edge Function, or external scheduler has been located.

Do not perform broad function revocations based on the partial map. The next safe action is to run repository-local exact searches on a complete checkout of this branch for all risky RPC names, then inspect database catalog dependencies and scheduler configurations, followed by a staging-only privilege/migration test.

## Safety

No production database or financial rows were queried/modified in this step; no SQL migration, grant, deployment, or merge was performed. Deposit crediting remains paused in this branch. Runtime tests/typecheck/lint/build were not executed here.
