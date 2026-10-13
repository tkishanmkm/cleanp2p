# Deposit-credit RPC caller and legacy-function audit — Step 35U

Date: 2026-10-14
Branch reviewed: `fix/retire-unverified-deposit-entrypoints`
Scope: static repository audit of deposit-credit SQL definitions and selected ingestion/worker files. No database connection, SQL execution, deployment, or runtime test was performed.

## Executive result

**BLOCKER — do not enable automatic deposit credit.** The repository contains a legacy `public.process_user_deposit(UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT)` SECURITY DEFINER function that directly increases wallet balances using caller-supplied user, address, asset, chain, amount, and transaction hash. Its migration explicitly grants EXECUTE to `anon`, `authenticated`, and `service_role`. The function does not verify a chain receipt, confirmations, transaction/log identity, destination ownership, or a signed verifier attestation before crediting. A later production grant state was not established by this source-only step, so the migration grant is a confirmed source risk, not proof that the current production ACL still permits it.

## Confirmed source findings

### 1. `process_user_deposit` is an unsafe legacy credit path — Critical

File: `supabase/migrations/20260910000001_add_process_user_deposit_rpc.sql`

- Declared `SECURITY DEFINER` with `search_path = public, pg_temp`.
- Takes `p_user_id`, `p_address`, `p_asset`, `p_chain`, `p_amount`, and `p_tx_hash` as arguments.
- Checks whether the transaction hash exists in several tables, but the check does not establish chain authenticity or bind a unique on-chain event to the requested user/address/asset/amount.
- Creates/updates a wallet balance from the caller-provided amount; if an asset record is missing, it falls back to updating the primary wallet balance.
- Writes a deposit as `completed` and an on-chain deposit as `CONFIRMED` with `confirmations = 12`, and writes a processed-deposit row. Those values are inserted by the function, not derived from verified chain data.
- The migration explicitly grants EXECUTE to `authenticated`, `anon`, and `service_role`.

The source must not be considered safe merely because the function is idempotent or uses a SECURITY DEFINER search path.

### 2. `claim_pending_withdrawals` has a broad migration grant — High, adjacent financial-RPC concern

The same migration creates a SECURITY DEFINER `claim_pending_withdrawals(INTEGER)` function that changes withdrawal status to `processing` and returns withdrawal data. The migration grants EXECUTE to `authenticated`, `anon`, and `service_role`. This is outside the deposit-credit fix itself, but its current production ACL and intended worker-only access should be confirmed in the separate withdrawal audit.

### 3. `process_incoming_deposit` is another legacy definition requiring full review — Critical until cleared

File: `supabase/migrations/20260909000000_hardened_core_rpcs.sql`

The migration defines `public.process_incoming_deposit(TEXT, TEXT, TEXT, NUMERIC, TEXT, INTEGER)` as a SECURITY DEFINER function. Its full body and all later ACL changes must be reconciled against the live database before it can be declared unreachable or safe. This step did not modify it.

### 4. Current ingestion path is intentionally fail-closed

Files reviewed include `src/jobs/depositIngestion.ts`, `src/jobs/confirmationsWorker.ts`, and `src/security/depositAttestation.ts`. The current ingestion code should continue to keep automatic credit disabled until the database credit boundary and every callable legacy path are independently verified. This audit did not establish a complete indirect-caller graph or live production ACL state.

## Caller-inventory completeness and limitations

- Repository recursive tree was retrieved for the fix branch.
- GitHub code-search queries for the RPC names and `.rpc(` returned no indexed matches; that result is **not** evidence that no callers exist. The search connector searches the default branch, so it is not authoritative for this fix branch.
- Targeted branch files and legacy SQL definitions were inspected. This is a useful confirmed finding, but **not a complete repository-wide caller inventory**.
- Live PostgreSQL function definitions, ACLs, overloads, triggers, scheduled jobs, Edge Functions, and indirect SQL callers were not queried in this step.
- No SQL was changed or executed. No production or staging database was modified.

## Required next actions

1. Keep deposit-credit entrypoints fail-closed; do not re-enable `process_deposit_atomic` or legacy RPCs.
2. Reconcile every deployed overload and EXECUTE grant in production and staging, including `process_user_deposit`, `process_incoming_deposit`, `process_deposit_atomic`, `credit_deposit_atomic`, `ingest_and_credit_deposit`, `credit_confirmed_deposit`, `credit_onchain_deposit`, `process_deposit`, and `process_incoming_deposit` variants.
3. Search all source and infrastructure paths on the fix branch (API routes, jobs, Edge Functions, triggers, cron definitions, SQL dynamic calls) for direct and indirect invocations.
4. Revoke unintended `anon`/`authenticated` EXECUTE permissions only after confirming signatures and dependency impact; do not treat revocation alone as a replacement trust boundary.
5. Design a dedicated credit interface that independently validates verified chain evidence, event identity, asset/network, exact amount, destination-to-user ownership, confirmation/finality policy, and replay protection inside the trusted boundary.
6. Add adversarial SQL/integration tests for forged amounts, wrong users/destinations, transaction/log replay, conflicting metadata, concurrent duplicate calls, and unauthorized roles before any credit path is enabled.

## Status

- Audit: **partial — critical legacy SQL flaw confirmed**
- Fixes in this step: **none; audit-only**
- Tests/build/runtime: **not run**
- Database/deployment changes: **none**
- Deposit production readiness: **NOT READY**
