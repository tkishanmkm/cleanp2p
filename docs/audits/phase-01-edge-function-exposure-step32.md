# Step 32 — Deployed Edge Function Exposure and Deposit Boundary Follow-up

Date: 2026-10-14
Project: eaiwgfxoiwxepinvcykg
Repository: tkishanmkm/cleanp2p
Branch: fix/phase-01-fail-closed-deposit-webhooks

## Scope

Read-only inspection of deployed Supabase Edge Function metadata and source, PostgreSQL function metadata/dependencies, and the draft branch's deposit worker and alias routes. No SQL was executed through any Edge Function. No production configuration or deployment was changed.

## Finding 1 — Active `exec-sql` Edge Function requires urgent security review

Deployed Edge Function metadata reports:
- Name/slug: `exec-sql`
- Status: ACTIVE
- Version: 7
- `verify_jwt: false`
- Source accepts POST JSON containing a `sql` string and runs it with `postgres(...).unsafe(sql)` using `SUPABASE_DB_URL`.
- Before execution, source checks an `x-email-function-secret` header against `EMAIL_FUNCTION_AUTH_SECRET`.
- CORS allows `*` and the custom secret header.
- If `SUPABASE_DB_URL` is missing, the error response includes `Object.keys(Deno.env.toObject())`, which can disclose environment variable names.
- SQL result rows are returned in the HTTP response.

### Impact and caveat

Because JWT verification is disabled and raw SQL is accepted, the shared secret is the primary application-level gate shown in the source. This is a high-impact design: if the secret is absent, exposed, or compromised, the endpoint may permit broad database reads or writes within the DB connection's privileges. Inspection alone does not establish that the secret has leaked or that the endpoint is currently exploitable without it.

### Required action

1. Identify every legitimate caller and the operational purpose of this endpoint.
2. If no longer needed, disable/remove it through a reviewed change.
3. If required, replace arbitrary SQL execution with narrowly scoped, typed operations; require strong authentication/authorization, restrict CORS to required origins, never return environment names, and limit result size and statement capabilities.
4. Rotate the shared secret if exposure is suspected, using a controlled operational process.
5. Review database role privileges for the connection URL and inspect access logs for unexpected requests. Do not expose secrets or log raw SQL parameters.
6. Verify the final deployed configuration and run negative/positive authorization tests before re-enabling any replacement.

No deployment was changed in this step.

## Finding 2 — Deployed/repository Edge Function drift

The deployed project lists two active functions:
- `send-email` (JWT verification disabled; source not reviewed in this step)
- `exec-sql` (JWT verification disabled; source reviewed above)

The draft repository tree contains `supabase/functions/send-email/index.ts` but no tracked `supabase/functions/exec-sql` source in the inspected tree. This is deployment drift: the deployed SQL execution endpoint is not represented in the reviewed branch, so code review alone would not cover it. `send-email` also needs a separate authorization review because its deployed metadata says JWT verification is disabled.

## Finding 3 — Deposit worker status and aliases

- `src/app/api/workers/deposit-worker/route.ts` already returns HTTP 503, `DEPOSIT_CREDITING_PAUSED`, and states that no deposits were credited. A source test checks this behavior.
- `src/app/api/cron/indexer/route.ts` similarly returns HTTP 503 and explicit paused status.
- `src/app/api/wallet/deposit/route.ts` returns HTTP 410 and does not accept or process caller-supplied transaction fields.
- `src/app/api/webhooks/deposits/route.ts` re-exports the retired webhook route.
- The retired listener and recovery diagnostic return HTTP 410 without querying or crediting.
- No changes were required for these inspected route files in this step.

## Finding 4 — Current privileged deposit RPC metadata

Read-only PostgreSQL catalog query confirmed the known legacy credit functions exist in `public`, are owned by `postgres`, and all named financial credit functions except the four-argument `process_user_deposit` overload are marked SECURITY DEFINER. No non-internal triggers directly reference these listed function OIDs. This does not rule out indirect calls from other functions, dynamic SQL, external jobs, or other environments.

## Limits

- This was not a full source-level caller inventory; GitHub code search is default-branch indexed and does not reliably search the draft branch.
- Database metadata inspection did not read financial rows.
- No tests, build, lint, or typecheck were executed.
- The deployed `send-email` function was not source-reviewed here.
- No production SQL, grants, environment variables, Edge Function settings, merge, or deployment changed.

## Next actions

1. Resolve `exec-sql` ownership and legitimate callers; then remove or replace the arbitrary-SQL endpoint under explicit operational approval.
2. Audit deployed `send-email` source and its shared-secret/auth behavior.
3. Complete branch-wide source searches and database function-to-function dependency analysis for legacy deposit RPCs.
4. Only then design a tested verifier-evidence-only deposit credit boundary and a safe legacy RPC retirement migration.

Status: production readiness is not established. Deposits remain paused in the draft branch.
