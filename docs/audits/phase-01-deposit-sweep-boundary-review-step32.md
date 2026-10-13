# Step 32 — Repository-wide deposit/sweep boundary review

Date: 2026-10-14
Repository: tkishanmkm/cleanp2p
Branch: fix/phase-01-fail-closed-deposit-webhooks
Scope: recursive Git tree inventory plus focused reads of active API routes, ingestion/sweeper workers, and sweep SQL migration. No production database rows were read or changed; no production SQL was executed.

## Findings

### 1. Deposit worker pause response is already corrected on this branch

- `src/app/api/workers/deposit-worker/route.ts` returns HTTP 503, `success: false`, `code: DEPOSIT_CREDITING_PAUSED`, `depositsPaused: true`, and explicitly says no deposits were credited.
- `src/app/api/cron/indexer/route.ts` similarly returns HTTP 503 and clearly reports that indexing/crediting is paused.
- `tests/deposit-worker-reports-paused.test.ts` includes source assertions for these contracts.
- The previously noted stale success message is not present in the current branch files reviewed.

### 2. Direct client and generic webhook deposit endpoints remain retired

- `src/app/api/wallet/deposit/route.ts` POST returns HTTP 410 and performs no database work.
- `src/app/api/webhooks/deposit/route.ts` POST returns HTTP 410 with `Cache-Control: no-store`.
- `src/app/api/webhooks/deposits/route.ts` re-exports the retired generic webhook route.

### 3. New material risk: the sweeper remains operational while deposit verification is paused

- `src/app/api/workers/deposit-sweep/route.ts` GET still authenticates a worker and calls `runDepositSweeper()`; POST is retired with HTTP 410.
- `src/jobs/sweeperWorker.ts` calls `claim_next_deposit_sweep`, can derive keys, fund gas, sign transactions, and broadcast sweeps.
- `supabase/migrations/20260925000000_sweeper_hardening.sql` implements `claim_next_deposit_sweep`. It automatically creates sweep operations for rows in `public.onchain_deposits` where `status = 'CONFIRMED'` and `is_swept = FALSE`, then claims pending/recoverable sweep operations.
- This is a material cross-boundary concern: the deposit pipeline is paused, but the sweep worker is not. The queue function's visible eligibility predicate relies on the database status field; the reviewed definition does not require an independently verified evidence record. This audit did not inspect financial rows, so it does not establish that any particular queued item is unsafe or that a sweep has occurred.

### 4. Legacy deposit credit RPC inventory remains incomplete

- GitHub code search returned no results for the legacy RPC names. The API supports code search on the default branch, so a no-result search cannot establish the absence of callers on the draft branch.
- A recursive tree listing was available, but exhaustive fetching/grepping of all 361 relevant API, job, library, Edge Function and migration files could not be completed within this tool-call pass.
- No broad revocation/retirement migration is safe until this inventory is complete and staging-tested.

## Decision

Do not disable or change the sweeper automatically in this step: that could interrupt recovery of already-broadcast operations or trap legitimate funds. Treat the active sweeper + status-only queue eligibility as a high-priority audit blocker. Before launch, the team must decide whether sweeps should be paused globally until verified-evidence linkage is available, or whether the claim function can prove each eligible deposit is evidence-backed without breaking recovery of existing in-flight sweeps.

## Next steps

1. Audit the entire `claim_next_deposit_sweep` dependency chain and later migrations that may replace its definition.
2. Map all producers of `onchain_deposits.status = 'CONFIRMED'`, sweep queue creation, and external invocations of `/api/workers/deposit-sweep`.
3. Design a staged guard that blocks new sweeps for unverified deposits while preserving reconciliation/recovery for sweeps already broadcast.
4. Finish a complete repository-wide RPC caller inventory and inspect deployed catalog dependencies before proposing legacy function revocations.
5. Run automated tests, typecheck, lint and build in a network-enabled environment.

## Safety status

No production SQL, grants, financial rows, config, merge, or deployment changed. Deposits remain paused in this draft branch. The sweeper is still active if its authenticated endpoint or worker is invoked. The platform is not production-ready.
