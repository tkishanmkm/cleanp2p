# Step 32 — Database Dependency and Deployed Edge Function Review

Date: 2026-10-14
Project: Paxones Supabase project `eaiwgfxoiwxepinvcykg`
Repository branch: `fix/phase-01-fail-closed-deposit-webhooks`
Scope: read-only catalog queries, deployed Edge Function metadata/source inspection, and draft-branch route/test inspection. No financial rows were read; no database, secret, or deployment changes were made.

## Critical finding: active arbitrary-SQL Edge Function

Supabase lists an active Edge Function named `exec-sql`, version 7, with `verify_jwt=false`. Its deployed source:
- Accepts POST JSON containing an arbitrary `sql` string.
- Connects using the environment variable `SUPABASE_DB_URL`.
- Executes caller-supplied SQL using `postgres(...).unsafe(sql)`.
- Uses a custom `x-email-function-secret` / `EMAIL_FUNCTION_AUTH_SECRET` check as its only request authorization.
- Returns SQL errors/results to the caller.
- Returns environment variable names in a 500 error when `SUPABASE_DB_URL` is absent.

The secret value was not read or exposed, and this review did not invoke the function. The secret's strength, distribution, logs, and actual reachability were not verified. Nonetheless, an active arbitrary-SQL endpoint is a critical attack surface: anyone who obtains the custom secret could run SQL with the database URL's privileges. CORS is permissive, but CORS alone is not the security boundary.

**Required containment:** urgently disable/remove this function or replace it with narrowly defined, parameterized operations; rotate `EMAIL_FUNCTION_AUTH_SECRET` and any database credential exposed to this function; inspect Edge Function logs and database audit logs for misuse. Do not merely enable JWT verification while retaining arbitrary SQL execution. Because this is a production-side change and requires coordinated credential handling, this step did not mutate the deployed function or secrets.

The function appears in the deployed Supabase project but was not present in the repository's listed `supabase/functions` paths (which included `send-email` only). This indicates repository/deployment drift and means the repo alone is not a complete source of truth.

## Deposit RPC catalog/dependency results

Read-only `pg_proc` inspection reconfirmed the following public functions are SECURITY DEFINER:
- `credit_confirmed_deposit(varchar, integer, varchar, uuid, varchar, numeric)`
- `credit_deposit_atomic(uuid, text, text, text, text, numeric, integer, integer)`
- `credit_onchain_deposit(text, text, numeric, text, text)`
- `ingest_and_credit_deposit(text, integer, text, text, numeric, text, integer)`
- `process_confirmed_deposit(uuid)`
- `process_deposit_atomic(text, text, text, numeric, text, integer, bigint, text, text, integer, text)`
- `process_incoming_deposit(text, text, text, numeric, text, integer)`
- Three SECURITY DEFINER overloads of `process_user_deposit`; one overload is SECURITY INVOKER.

The deployed database source scan found one named function-to-function caller among those functions: `process_user_deposit(uuid, text, text, numeric, text, text, text)` references `process_deposit_atomic`. This is a source-text scan, not a complete dependency graph; dynamic SQL, triggers, external callers, and application-side RPC calls are not represented by this result.

## Draft-branch route status

- `/api/workers/deposit-worker` returns HTTP 503 with `DEPOSIT_CREDITING_PAUSED`; it does not claim ingestion succeeded.
- `/api/cron/indexer` returns HTTP 503 and explicitly states no deposits were credited.
- `/api/webhooks/deposit` and its `/api/webhooks/deposits` alias return HTTP 410.
- `/api/wallet/deposit` and `/api/workers/deposit-listener` are retired.
- `/api/verify-deposit-recovery` is retired.
- `/api/workers/confirmations` is authenticated and reports diagnostic-only status, not deposit verification.
- `tests/deposit-worker-reports-paused.test.ts` asserts the paused responses and absence of the old success message; tests were inspected but not executed.

## Next actions

1. Treat the deployed `exec-sql` function as the urgent priority: review logs, disable it, rotate its custom secret and database credential, and confirm it is absent/harmless after containment.
2. Inventory all deployed Edge Functions against repository source and investigate why `exec-sql` is not tracked in the branch.
3. Complete static caller searches in a local checkout and inspect triggers, dynamic SQL, external schedulers, and all app-side RPC wrappers. GitHub code search returned no matches and is not reliable enough to establish absence.
4. Design verifier-owned deposit evidence and an evidence-ID-only atomic credit function; only then retire legacy RPCs with a tested migration.

## Safety status

No production database schema/grants, financial rows, Edge Function code, secrets, deployment, merge, or config were changed. Deposit crediting remains paused in the draft branch. This platform is not production-ready while these findings remain open.
