# Step 32 — Live Supabase Edge Function Drift and Arbitrary SQL Endpoint

Date: 2026-10-14
Project: `eaiwgfxoiwxepinvcykg`
Repository branch: `fix/phase-01-fail-closed-deposit-webhooks`
Scope: read-only inspection of deployed Edge Function metadata/source and the corresponding draft-branch source. No function was deployed or disabled.

## Finding: deployed `exec-sql` does not match the retired source

The deployed Supabase Edge Function inventory reports:

- Slug: `exec-sql`
- Status: `ACTIVE`
- Version: `7`
- `verify_jwt: false`
- Source hash: `0819c142f8a64bfdea47aa791b6cbe81732c894456b125058205805f4df4306b`

The live function source accepts POST JSON containing `sql`, validates a shared `x-email-function-secret` against `EMAIL_FUNCTION_AUTH_SECRET`, then passes the caller-supplied SQL to `postgres(dbUrl).unsafe(sql)` using `SUPABASE_DB_URL`. This is an arbitrary SQL execution endpoint protected only by a custom shared secret at the Edge Function layer; Supabase JWT verification is disabled. If the shared secret or calling environment is compromised, the endpoint can execute SQL with the database URL's privileges. The function also returns database error messages to callers and, when database URL configuration is missing, returns environment variable names.

This is a critical operational drift finding because the draft repository's `supabase/functions/exec-sql/index.ts` is already a retired HTTP 410 stub, and `tests/exec-sql-edge-function-retired.test.ts` asserts the source no longer parses request JSON, reads database credentials, or calls `.unsafe()`. Those source changes do not automatically update the deployed Edge Function.

## Deposit-credit caller mapping — live database observations

A read-only catalog query of deployed public routines and non-internal triggers found the previously identified privileged deposit-credit routines still present. The targeted trigger query returned no direct triggers whose trigger function name exactly matched the listed credit RPCs. This does not rule out indirect SQL dependencies, wrappers, triggers that call other helpers, dynamic calls, or external callers.

The deployed definitions continue to show caller-supplied fields driving credits, including:
- `ingest_and_credit_deposit(...)`: treats `p_confirmations >= 1` as confirmed and credits balances.
- `credit_onchain_deposit(...)`: inserts completed deposit and credits balance from supplied transaction/address/amount fields.
- `process_incoming_deposit(...)`: credits when caller-supplied confirmations are at least one.
- `process_user_deposit(...)`: at least one overload passes `p_confirmations := 100` into `process_deposit_atomic`; other overloads directly credit balances.
- `credit_confirmed_deposit(...)` and `process_confirmed_deposit(uuid)`: directly update balances/ledger based on parameters or stored state; safe use depends on a trusted evidence-backed state transition not established here.

These observations are from function definitions/catalog metadata, not financial rows.

## Required next actions

1. Treat the live `exec-sql` endpoint as a critical deployment blocker. Disable it or deploy the already-reviewed retired stub through an explicitly approved operational change, then verify the live function version and source hash again. Do not assume the repository commit retired the deployed function.
2. Before disabling it, identify any legitimate maintenance workflow that still depends on it and replace that workflow with narrow, fixed SQL operations with validated parameters. Do not retain general-purpose SQL execution as a public Edge Function.
3. Rotate `EMAIL_FUNCTION_AUTH_SECRET` and assess access/logs if there is any possibility the endpoint or secret was exposed. Do not put secret values in GitHub or chat.
4. Continue the complete branch-scoped repository caller scan and deployed SQL dependency inspection before retiring legacy credit RPCs.
5. Implement verifier-owned evidence records and a credit function that consumes only a unique evidence ID; test replay, wrong recipient/asset/amount, reorgs, and concurrency in staging.

## Change and verification status

- No production SQL, financial rows, secrets, Edge Function version, deployment, merge, or configuration was changed.
- The deployed `exec-sql` function remains active at the time of inspection; this report is not remediation.
- The repository already contains a retired stub and static source test, but no test proves the live deployment matches it.
- Automated deposits remain paused in the draft branch.
- Full runtime tests, typecheck, lint, build, and end-to-end verification remain outstanding.

**Status: not production-ready.**