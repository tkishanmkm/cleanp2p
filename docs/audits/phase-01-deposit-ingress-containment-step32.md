# Step 32 — Deposit Ingress and Administrative Endpoint Containment Review

Date: 2026-10-14
Repository: tkishanmkm/cleanp2p
Branch: fix/phase-01-fail-closed-deposit-webhooks

## Scope
Read-only inspection of the current draft branch's deposit entry points, worker status contracts, and privileged administrative Edge Function. No production database mutation, financial-row access, merge, or deployment was performed.

## Verified in the current branch

| Entry point | Observed behavior | Result |
|---|---|---|
| `src/app/api/workers/deposit-worker/route.ts` | Requires worker authentication; calls fail-closed ingestion; returns HTTP 503 with `DEPOSIT_CREDITING_PAUSED`, `depositsPaused: true`, and an explicit no-credit message. | Contained; callers must treat 503 as paused, not success. |
| `src/app/api/cron/indexer/route.ts` | Requires worker/cron authentication; calls fail-closed ingestion; returns HTTP 503 and explicit paused status. | Contained; not a live indexer. |
| `src/app/api/wallet/deposit/route.ts` | POST returns HTTP 410; caller-supplied deposit facts are not processed. | Retired. |
| `src/app/api/webhooks/deposits/route.ts` | Re-exports the retired `/api/webhooks/deposit` POST handler. | Alias remains fail-closed if target route remains retired. |
| `src/app/api/verify-deposit-recovery/route.ts` | GET returns HTTP 410, no-store; no admin-client or financial queries. | Retired. |
| `src/app/api/internal/chain-ingest/route.ts` | Existing test asserts HTTP 410, paused state, no-store, and no Supabase client/RPC invocation. | Source assertions exist; runtime test not run here. |
| `supabase/functions/exec-sql/index.ts` | Returns HTTP 410 with `ADMIN_SQL_ENDPOINT_RETIRED`; current source does not parse request bodies, use DB URL credentials, or execute arbitrary SQL. | Retired in source; deployed Edge Function state must be checked separately. |
| `tests/deposit-worker-reports-paused.test.ts` | Contains source assertions for the deposit worker and indexer paused response. | Test exists; command not run here. |
| `tests/exec-sql-edge-function-retired.test.ts` | Contains assertions for the retired arbitrary-SQL endpoint. | Test exists; command not run here. |
| `tests/chain-ingest-retired.test.ts` | Contains assertions that internal chain-ingest performs no RPC or Supabase-client call. | Test exists; command not run here. |

## Critical finding unchanged
The canonical SQL function `public.process_deposit_atomic` accepts caller-supplied transaction fields and confirmation count. Other deployed privileged SECURITY DEFINER deposit functions have similar input-trust risks, documented in Step 30. Disabled application ingress does not itself remove database capabilities or prove all external callers have been retired.

GitHub code search for legacy RPC names returned no results, but the connector searches the default branch and does not provide a reliable exhaustive search of this draft branch. Zero search results are not proof of zero callers. No broad SQL revoke/drop migration is safe until repository and deployed dependency inventories are complete.

## Required next actions
1. Obtain a complete local checkout of this exact branch and search every legacy RPC name across application source, dynamic wrappers, triggers, jobs, Edge Functions, and migration SQL.
2. Inspect deployed catalog metadata for function definitions, grants, triggers, and dependencies. Do not query financial transaction rows for this task.
3. Identify and retire external schedulers or deployed Edge Functions that can invoke legacy credit routines.
4. Design verifier-owned evidence records bound to network, canonical block, transaction hash, output/log index, successful receipt, recipient, asset/contract, and amount. Credit must consume a unique evidence ID atomically; caller-supplied confirmation counts are not proof.
5. After caller mapping, prepare narrowly scoped revocations, test on staging, and verify deployed ACLs afterward.

## Status
Step 32 confirms additional ingress containment and source-level test coverage. It does not complete the caller inventory or implement a verifier-backed credit boundary. Tests, typecheck, lint, and build remain unexecuted in this environment. No production SQL, grants, financial rows, configuration, merge, or deployment changed. Deposits remain paused in the draft; the platform is not yet production-ready.
