# Step 32 — Deposit RPC caller sweep (server entrypoints)

Date: 2026-10-14
Repository: tkishanmkm/cleanp2p
Branch: fix/phase-01-fail-closed-deposit-webhooks
Scope: read-only inspection of 37 targeted server/API, worker, wallet-service and test files on the draft branch. No database or financial rows were read or changed in this step.

## Findings

### 1. Active deposit routes remain fail-closed

Inspected the following route families:
- `src/app/api/webhooks/{blockcypher,litecoin,alchemy,deposit,deposits}/route.ts`
- `src/app/api/wallet/deposit/route.ts`
- `src/app/api/{deposit-address,wallet/deposit-address,wallet/deposit-addresses,wallets/deposit-address,wallets/provision-address,wallet/create-address}/route.ts`
- `src/app/api/workers/{deposit-worker,deposit-listener,deposit-sweep,sweeper,confirmations}/route.ts`
- `src/app/api/cron/{indexer,confirmations,sweeper,reconcile,reconcile-ledger,withdrawals}/route.ts` and `src/app/api/cron/withdrawals/dispatch/route.ts`
- `src/app/api/verify-deposit-recovery/route.ts`

The retired webhook/listener/recovery routes do not contain active calls to the audited credit RPC names. The deposit worker and indexer return HTTP 503 with `DEPOSIT_CREDITING_PAUSED`, `depositsPaused: true`, and explicit text that no deposits were credited. This corrects the stale success-message concern noted in Step 31; no route change was necessary.

### 2. Targeted application callers

Also inspected:
- `src/jobs/depositIngestion.ts`
- `src/jobs/confirmationsWorker.ts`
- `src/jobs/sweeperWorker.ts`
- `src/worker.ts`
- `src/lib/wallet-api.ts`
- `src/services/walletApi.ts`
- `src/app/api/wallet/transfer/route.ts`
- selected wallet-balance/history/admin routes and withdrawal worker routes.

No direct application call to these audited deposit-credit RPC names was found in the inspected files:
`ingest_and_credit_deposit`, `credit_onchain_deposit`, `credit_deposit_atomic`, `process_incoming_deposit`, `credit_confirmed_deposit`, `process_confirmed_deposit`, `process_user_deposit`, `process_deposit_atomic`.

The transfer endpoint does call `execute_internal_transfer`; that is outside this deposit-credit caller inventory and must be audited in the internal-transfer workstream. The sweeper worker invokes separate sweep lifecycle RPCs; these are not deposit-credit RPCs and are not being disabled by this step.

### 3. Remaining blocker: database-side and external callers

This targeted route sweep is not proof of zero callers. The following remain unverified:
- all SQL function bodies and triggers across every migration, including dynamic `EXECUTE` SQL;
- Supabase Edge Functions beyond the inspected route paths;
- production catalog dependencies and deployed function definitions/ACLs for every overload;
- external provider callbacks, manual scripts, cron providers and other environments;
- dynamic RPC names or references assembled from variables.

Because those callers have not been conclusively mapped, this step does **not** add broad revocations or replace deposit RPCs. A blanket revoke could break legitimate operations without proving that all entrypoints are migrated.

## Current safe state

- Automated deposit scanning/crediting remains paused in the draft branch.
- Webhook and legacy diagnostic entrypoints inspected here are retired or fail closed.
- No production SQL, grants, financial rows, environment settings, merge or deployment changed.
- Existing focused tests are present, including `test:deposit-worker-reports-paused`; test execution, typecheck, lint and build were not performed in this step.

## Next action

Continue with a database-side inventory: inspect the deployed catalog for every overload of the legacy credit functions, enumerate triggers and SQL function definitions that reference them, and compare deployed ACLs with migration history. Only after the caller graph is complete should a verifier-evidence credit function and retirement migration be finalized for staging review.
