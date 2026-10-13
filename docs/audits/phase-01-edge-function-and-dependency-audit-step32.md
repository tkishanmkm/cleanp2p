# Step 32 — Deployed Edge Function and Deposit Privilege Dependency Audit

Date: 2026-10-14
Project: Paxones Supabase project `eaiwgfxoiwxepinvcykg`
Repository branch: `fix/phase-01-fail-closed-deposit-webhooks`

## Scope

Read-only inspection of the deployed PostgreSQL function catalog/ACLs and deployed Supabase Edge Function inventory/source. No financial rows were queried. No SQL, grants, secrets, function configuration, deployments, or production data were changed.

## Findings

### High risk: deployed `exec-sql` Edge Function is a general SQL execution endpoint

The deployed Edge Function inventory reports:
- slug: `exec-sql`
- status: ACTIVE
- version: 7
- `verify_jwt: false`

Its deployed source checks a custom `x-email-function-secret` header against `EMAIL_FUNCTION_AUTH_SECRET`, then accepts a JSON `sql` string and executes it using `postgres(dbUrl).unsafe(sql)` with `SUPABASE_DB_URL`. This means the endpoint is not protected by Supabase JWT verification and its security boundary depends entirely on the secrecy and strength of the custom shared secret and the privileges of the database URL.

Additional concerns observed in source:
- It exposes the names of environment variables in an error response when `SUPABASE_DB_URL` is missing.
- It returns raw database error messages and SQL results to the caller.
- It uses wildcard CORS. CORS is not authentication, and does not protect the endpoint from non-browser callers.
- It has broad arbitrary-SQL capability rather than a narrowly scoped operation allowlist.

This is not proof that an unauthenticated caller can bypass the shared-secret check. However, if the secret is exposed, weak, reused, or logged, the endpoint can become a direct database compromise path. Treat this as a high-priority production security finding.

### Deployed legacy deposit RPC ACLs and dependency limitation

A read-only catalog query found the listed legacy credit functions are SECURITY DEFINER except the four-argument `process_user_deposit(uuid, text, text, numeric)` overload. The effective ACL strings for the inspected signatures list `postgres`, `service_role`, and `supabase_auth_admin`; they do not list `anon` or `authenticated` in the current ACLs.

The same query returned zero `pg_depend` entries where each function was the referenced function. PostgreSQL catalog dependencies are not a complete application caller graph: dynamic RPC invocations, external schedulers, and application calls are not necessarily represented there. Therefore zero dependencies does not prove a function is unused.

### Deposit worker route status

The current branch version of `src/app/api/workers/deposit-worker/route.ts` already returns:
- `success: false`
- `code: DEPOSIT_CREDITING_PAUSED`
- `depositsPaused: true`
- HTTP 503
- a message that no deposits were credited

This corrects the stale-success-message concern raised in Step 31; no additional route change was needed.

## Required remediation before production

1. **Immediately review and contain `exec-sql` outside this audit PR.** Because it is a deployed privileged capability, have the project owner/security operator disable it or restrict it through a controlled change, rotate `EMAIL_FUNCTION_AUTH_SECRET` if exposure cannot be ruled out, and inspect logs for unexpected use. Do not paste secrets into chat. Coordinate this with the owner because disabling it may affect legitimate admin workflows.
2. Replace arbitrary SQL execution with narrowly scoped administrative operations, or remove the function entirely. Do not merely turn JWT verification on while retaining unrestricted arbitrary SQL as the only control.
3. If retained temporarily, use a dedicated least-privilege database role, strong rotated secret stored only in server-side secrets, no environment-key disclosure, sanitized errors, restricted network/origin where applicable, and audited access. These mitigations do not substitute for removing arbitrary SQL.
4. Continue complete source and external scheduler caller inventory for legacy deposit RPCs. Catalog dependency counts alone are insufficient.
5. Implement verifier-owned evidence records and an atomic credit function that accepts only a unique evidence ID. Retire legacy functions only after caller migration and staging validation.

## Status

This is an audit/report commit only. No production function was disabled or redeployed; no production SQL, grants, secrets, configuration, or financial rows changed. Deposits remain paused in the draft branch. Runtime tests, typecheck, lint, and build remain unverified. Do not claim production readiness.
