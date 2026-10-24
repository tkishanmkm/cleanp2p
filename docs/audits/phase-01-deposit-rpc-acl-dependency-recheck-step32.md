# Step 32 — Deployed Deposit RPC ACL and Dependency Recheck

Date: 2026-10-14
Repository: tkishanmkm/cleanp2p
Branch: fix/phase-01-fail-closed-deposit-webhooks
Scope: targeted source review plus read-only Postgres catalog queries. No financial rows were read, no SQL/ACLs were changed, and no migration was applied.

## Results

### 1. Current worker status response is already fail-closed

The current draft version of `src/app/api/workers/deposit-worker/route.ts` returns:
- HTTP 503
- `success: false`
- `code: DEPOSIT_CREDITING_PAUSED`
- `depositsPaused: true`
- an explicit message that no deposits were credited pending independent chain verification.

The existing `tests/deposit-worker-reports-paused.test.ts` asserts this behavior and also checks the indexer route. The stale success message described as a follow-up in Step 31 is not present in the current branch version; no redundant edit was needed.

### 2. Deployed function ACLs rechecked

A read-only query against `pg_proc` inspected all deployed overloads for:
- `credit_confirmed_deposit`
- `credit_deposit_atomic`
- `credit_onchain_deposit`
- `ingest_and_credit_deposit`
- `process_confirmed_deposit`
- `process_incoming_deposit`
- `process_user_deposit` (four overloads)
- `process_deposit_atomic`

All listed functions are owned by `postgres`. All except the four-argument `process_user_deposit(uuid,text,text,numeric)` are SECURITY DEFINER. The SECURITY INVOKER overload is still financial logic and must not be assumed safe just because it is not SECURITY DEFINER.

The inspected effective ACLs listed execute for `postgres`, `service_role`, and `supabase_auth_admin`; they did not list `anon` or `authenticated`. This is evidence about current catalog ACLs only, not a proof that every API route, service credential, SQL trigger, or external system is safe.

### 3. Database function-body and trigger scan

A read-only catalog scan looked for the risky RPC names inside deployed function source and also enumerated deposit-named triggers. It found:
- A `process_user_deposit` overload whose body includes deposit validation and the canonical credit path; this remains a caller-supplied-input risk until it is converted to evidence-backed input.
- Deposit-address profile synchronization triggers (`on_deposit_address_inserted`, `trg_sync_deposit_addresses`). These update profile address fields and are not themselves deposit-credit triggers.
- No other matching function-body references to the named legacy credit RPCs in the returned catalog rows.

This query is not a complete dependency graph: dynamic SQL, application RPC strings, Edge Functions, external schedulers, and code paths outside database function bodies are not covered.

### 4. Targeted branch source inspection

The following 16 current-branch files were directly inspected: indexer route, deposit worker route, confirmation cron/worker routes, wallet deposit route, four webhook routes, ingestion and confirmation jobs, retired listener and recovery diagnostic routes, `src/worker.ts`, and `vercel.json`.

The inspected active worker/indexer routes do not directly call credit RPCs; they invoke fail-closed jobs. Webhook and legacy diagnostic endpoints remain retired. The selected files are not a substitute for a full local repository-wide text search.

GitHub code search returned no matches for the eight RPC names, but that search is indexed against the default branch and is not reliable evidence about this draft branch. A complete source scan is therefore still open.

## Current safety decision

Do not resume deposits. Do not revoke legacy RPCs until all legitimate callers and external integrations have been mapped. Do not apply a production migration yet.

## Step 33 plan

1. Obtain a complete local checkout of this exact branch and run repository-wide searches for every risky RPC name across application source, tests, migrations, scripts, and workflow files.
2. Inspect all SQL functions and triggers with direct or dynamic financial side effects; inspect Supabase Edge Functions and scheduler configurations.
3. Design a new verifier-owned evidence table and a credit function accepting only a unique evidence ID. Evidence must bind chain/network, canonical block, exact transaction/output or event log index, successful execution, recipient, asset/contract and exact amount.
4. Add adversarial tests for forged confirmations, wrong recipient/asset, altered amount, duplicate/replayed event, concurrent credit, failed receipt, and reorg handling.
5. Only after caller migration and staging verification, prepare narrowly scoped ACL changes to retire unsafe legacy functions.

## Validation and change log

- No production SQL, ACLs, financial rows, configuration, merge, or deployment changed.
- No runtime test suite, typecheck, lint, or production build was executed in this step.
- This report records a targeted recheck, not a completed exhaustive caller inventory.
