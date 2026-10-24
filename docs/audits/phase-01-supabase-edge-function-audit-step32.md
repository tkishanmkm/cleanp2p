# Step 32 — Supabase Edge Function and SQL Dependency Audit

Date: 2026-10-14
Project: Paxones Supabase project `eaiwgfxoiwxepinvcykg`
Repository branch: `fix/phase-01-fail-closed-deposit-webhooks`

## Critical finding: active arbitrary-SQL Edge Function

The deployed Edge Function inventory returned two active functions: `send-email` and `exec-sql`. The deployed `exec-sql` function was version 7 with `verify_jwt=false`. Its code:
- accepts POST JSON containing a caller-supplied `sql` string;
- checks a custom `x-email-function-secret` against `EMAIL_FUNCTION_AUTH_SECRET` (so this is not unauthenticated in the absence of the secret, but JWT verification is disabled);
- opens a Postgres connection using `SUPABASE_DB_URL`;
- executes the supplied statement with `sqlClient.unsafe(sql)`;
- returns raw SQL error messages to the caller;
- on missing DB URL, returns the list of environment variable names;
- allows wildcard CORS.

This is a high-severity administrative capability: anyone obtaining the shared secret can submit arbitrary SQL with the database URL's privileges. Raw database errors and environment-key names also unnecessarily disclose operational details. Do not treat the custom secret as a sufficient boundary for a general-purpose SQL console.

### Draft remediation prepared

Added `supabase/functions/exec-sql/index.ts` on this draft branch. It retires the endpoint with HTTP 410 (OPTIONS receives 204), never reads the request body, never reads database environment variables, and contains no SQL client or execution path. Added `tests/exec-sql-edge-function-retired.test.ts` and package script `test:exec-sql-edge-function-retired`.

**This only changes the GitHub draft branch. It does not change the currently deployed Edge Function.** The live function remains active until an explicitly reviewed deployment or dashboard action is performed. Do not assume this finding is remediated in production.

GitHub search for `exec-sql`, `EMAIL_FUNCTION_AUTH_SECRET`, `x-email-function-secret`, and `SUPABASE_DB_URL` returned no matches in the connector's indexed code search. That search covers the default branch, not reliably the current draft branch, and is not proof that external clients or other repositories do not call the function. Confirm usage with logs/configuration and rotate the dedicated secret if exposure is suspected. Never paste the secret into chat.

## Read-only database dependency check

A read-only catalog query inspected the eight known legacy deposit-credit function families, references from other stored function bodies, and non-internal triggers on deposit-named tables/functions.

- The only text references returned were among overloaded `process_user_deposit` definitions, including a wrapper referencing `process_deposit_atomic`; this was not evidence of a distinct trigger caller.
- The non-internal triggers returned for `user_deposit_addresses` were address/profile synchronization triggers, not deposit-credit triggers.
- The target credit functions are SECURITY DEFINER; the inspected ACL output showed service-role execution entries. No grants were changed.
- The query searched function source text, not arbitrary dynamic SQL, external callers, job queues, or code outside the connected project. It does not prove the complete caller inventory.

## Deposit-route status check

Re-fetched the draft versions of the wallet deposit endpoint, generic webhooks, BlockCypher/Litecoin/Alchemy routes, indexer route, confirmation route, ingestion job and worker. The inspected direct deposit endpoints return 410; the indexer and deposit worker return 503 with an explicit paused status; the ingestion job returns zero credits and contains no call to `process_deposit_atomic`. The confirmation route is explicitly diagnostic-only.

The existing `tests/deposit-worker-reports-paused.test.ts` includes assertions for both the deposit worker and cron indexer paused response, but automated tests have not been executed in this environment.

## Remaining requirements

1. Confirm whether the live `exec-sql` function is used; migrate legitimate maintenance tasks to fixed, narrowly scoped functions.
2. Review the draft retirement code, then explicitly approve/deploy it. Until then the live arbitrary-SQL endpoint remains a production risk.
3. Complete source-controlled caller inventory using a branch-aware local checkout/grep, including every RPC call, dynamic RPC wrapper, Edge Function, external scheduler and admin tooling. The GitHub code-search connector is indexed against the default branch and cannot establish this by itself.
4. Build verifier-owned chain evidence before any deposit-credit function can be safely restored.
5. Run the new static test plus full tests, typecheck, lint and build in CI.

## Change and safety statement

Added only draft-branch source/test/package changes. No production Edge Function was deployed or modified, no SQL/ACL was changed, no financial rows were queried or modified, and no PR merge/deployment occurred. Wallet deposits remain paused. This platform is not yet production-ready.
