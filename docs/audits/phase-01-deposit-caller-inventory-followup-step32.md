# Step 32 — Caller Inventory Follow-up and Paused Worker Responses

Date: 2026-10-14
Repository: tkishanmkm/cleanp2p
Branch: fix/phase-01-fail-closed-deposit-webhooks
Scope: read-only inspection of the recursive Git tree and selected draft-branch source/migration files. No database mutation, merge, or deployment.

## Repository inventory

The Git tree for the draft branch resolved successfully with 740 files matching the broad source extensions `.ts`, `.tsx`, `.js`, or `.sql`. Relevant areas include Next.js API routes, background jobs, a worker entry point, Supabase migrations, a Supabase Edge Function, and deposit-specific tests. This establishes the scope is larger than the handful of webhook routes previously reviewed.

A complete content-level grep across all 740 files was not completed: a bulk blob-fetch attempt exceeded the connector's tool-call limit. GitHub code search is documented to cover the default branch, so it cannot safely be treated as a draft-branch-wide inventory. This step therefore does not claim that all callers have been found.

## Findings verified in selected files

- `src/app/api/workers/deposit-sweep/route.ts`, `src/app/api/workers/sweeper/route.ts`, `src/jobs/sweeperWorker.ts`, `src/jobs/withdrawalWorker.ts`, and `src/worker.ts`: no literal references to the audited legacy deposit-credit RPC names were found in these fetched files. This is a narrow text check, not a proof of transitive safety.
- `src/app/api/workers/deposit-worker/route.ts`: already returns `success: false`, code `DEPOSIT_CREDITING_PAUSED`, and HTTP 503 with a message explicitly stating no deposits were credited.
- `src/app/api/cron/indexer/route.ts`: likewise returns `DEPOSIT_CREDITING_PAUSED` and HTTP 503 rather than claiming successful indexing.
- `tests/deposit-worker-reports-paused.test.ts`: source assertions already cover both route responses and the fail-closed ingestion job. The test file exists on the branch; this connector-only review did not execute it.
- `supabase/migrations/20260924000000_canonical_deposit_rpc_v2.sql`: defines `process_deposit_atomic` and includes a revoke for PUBLIC, anon, and authenticated in that migration.
- `supabase/migrations/20260910000001_add_process_user_deposit_rpc.sql`: historical migration grants execute on one `process_user_deposit` overload to authenticated, anon, and service_role. Later migrations/deployed ACLs must be considered before drawing conclusions about current privileges.
- `supabase/migrations/20261009000000_archive_and_disable_obsolete_financial_rpcs.sql`: the fetched text contained no literal references to the audited RPC names; this alone does not establish whether functions were disabled by indirect/dynamic SQL or whether all overloads were covered.

## Risk decision

Do not add broad REVOKE/DROP statements based on this partial caller search. A missed worker, trigger, RPC wrapper, external scheduler, or environment-specific caller could silently break legitimate wallet operations. Conversely, preserving a legacy credit function with weak trust boundaries remains a serious risk. The correct next gate is a complete local checkout grep plus catalog dependency/ACL review in a staging environment, then a verifier-owned evidence boundary and an explicit legacy cutover plan.

## No production changes

No production SQL, grants, financial rows, environment configuration, merge, or deployment changed. Deposits remain paused in the draft branch. Runtime tests, typecheck, lint, and build have not been executed in this step. The project must not be considered production-ready.
