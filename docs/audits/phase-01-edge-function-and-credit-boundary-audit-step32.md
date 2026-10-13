# Step 32 — Live Edge Function and Credit Boundary Audit

Date: 2026-10-14
Project: eaiwgfxoiwxepinvcykg
Repository branch: fix/phase-01-fail-closed-deposit-webhooks
Scope: read-only deployed function catalog and Edge Function source inspection; source-tree inventory on the draft branch. No financial rows were read, and no production configuration/function was changed.

## Findings

### Critical: active `exec-sql` Edge Function accepts arbitrary SQL

The deployed project lists an ACTIVE Edge Function named `exec-sql`, version 7, with `verify_jwt=false`. Its source:
- accepts POST requests containing a JSON `sql` string;
- compares a custom `x-email-function-secret` header with `EMAIL_FUNCTION_AUTH_SECRET`;
- connects using `SUPABASE_DB_URL` and executes the supplied string via `postgres(...).unsafe(sql)`;
- returns the SQL result to the caller;
- includes `Access-Control-Allow-Origin: *`;
- returns environment variable names when `SUPABASE_DB_URL` is missing and returns raw exception messages.

The custom shared secret is the only visible authorization gate in this function; Supabase JWT verification is disabled. If the secret is absent or exposed through source, logs, client bundles, deployment config, or a caller, the endpoint can provide arbitrary database access with the privileges of `SUPABASE_DB_URL`. The exact database role and secret strength/rotation status were not verified. Treat this as a critical production blocker. Do not send real secrets or SQL credentials in chat.

**Immediate recommendation:** if this endpoint is not strictly required, disable/remove it through the authorized deployment workflow. If required for operations, replace arbitrary SQL execution with narrowly allowlisted, typed operations; require server-side authentication/authorization, keep credentials server-only, and remove SQL result/error/environment detail exposure. Rotate any credential that may have been exposed. I did not change or disable the live function because that would be a production change.

### High: privileged deposit RPCs still trust caller input

The deployed catalog query reconfirmed that the listed functions are `SECURITY DEFINER`, with execute ACLs for `service_role` (and postgres/supabase_auth_admin) in the inspected ACL representation:
- `credit_confirmed_deposit(...)`
- `credit_deposit_atomic(...)`
- `credit_onchain_deposit(...)`
- `ingest_and_credit_deposit(...)`
- `process_confirmed_deposit(uuid)`
- `process_incoming_deposit(...)`
- `process_user_deposit(...)` overloads
- `process_deposit_atomic(...)`

The definitions continue to rely on caller-provided values or previously stored state that is not proven to have originated from an independent chain verifier. Do not resume deposit crediting or broadly revoke these functions until all internal and external callers are mapped and a tested replacement exists.

### Worker status clarification

The current draft branch's `src/app/api/workers/deposit-worker/route.ts` already reports `DEPOSIT_CREDITING_PAUSED`, `depositsPaused: true`, and HTTP 503, with an explicit no-credit message. The existing `tests/deposit-worker-reports-paused.test.ts` contains assertions for this and the indexer response. The stale-message issue noted in Step 31 is therefore already addressed in the inspected branch; no duplicate code change was needed.

### Edge Function inventory

The deployed project lists:
- `send-email` — ACTIVE, `verify_jwt=false`
- `exec-sql` — ACTIVE, `verify_jwt=false`

Only `send-email` is present under `supabase/functions` in the inspected repository tree. The deployed `exec-sql` source is not represented there, creating a source-control/deployment drift concern. The send-email function's authorization was not audited in this step.

### Caller-map completeness

The repository tree contains 740 TypeScript/TSX/JavaScript/SQL/JSON files. This step identified the deployed Edge Function above but did not perform a complete local content scan of every file and every dynamic RPC/SQL call. The repository's current branch source search and deployed SQL dependency metadata have not yet established all callers. This report must not be interpreted as an exhaustive caller inventory.

## Safe next actions

1. Review and explicitly authorize how to handle the active `exec-sql` function. Do not leave an arbitrary-SQL endpoint in production solely because it has a custom secret header.
2. Bring the deployed Edge Function source under version control, or remove it through the approved deployment workflow.
3. Audit `send-email` separately for authentication, abuse controls, secret handling and PII disclosure.
4. Complete repository-wide source-content scan plus database dependency/trigger inspection before retiring legacy deposit RPCs.
5. Implement a verifier-owned evidence record and a credit RPC that accepts only a unique evidence identifier; test event uniqueness, recipient/asset/amount binding, replay, reorg and concurrency in staging.

## Safety status

Read-only audit only. No production function, SQL, grant, secret, config, financial row, merge or deployment changed. Deposit crediting remains paused in the draft branch. Production readiness is not established.
