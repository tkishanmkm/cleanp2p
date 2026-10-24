# Phase 01 Step 14 — Focused privileged RPC security review

**Status:** Static source review of selected high-risk migrations. No SQL executed and no database changed.

## Files reviewed
- `supabase/migrations/20260903000002_withdrawal_rpcs.sql`
- `supabase/migrations/20260928040000_withdrawal_security_boundary_hardening.sql`
- `supabase/migrations/20261003030000_fix_admin_authorization_rpcs.sql`
- `supabase/migrations/20261003040000_fix_admin_authorization_rpcs.sql`

## Findings

### Critical accounting pattern in the older withdrawal migration
The earlier `20260903000002_withdrawal_rpcs.sql` catches `WHEN OTHERS` and suppresses errors around both withdrawal-lock and refund ledger inserts. That can allow a balance/state change to commit without its corresponding ledger entry. Later hardening and draft PR #32 address the ledger exception suppression in the older migration, but production schema drift means that proposed migration cannot safely be applied without reconciliation.

The same older function also attempts a legacy `withdrawals` mirror insert under a blanket exception handler. This can hide schema/constraint incompatibility; whether the mirror is optional must be decided from actual callers and reconciliation requirements.

### Privileged withdrawal RPCs require caller-contract verification
The reviewed security-boundary migration drops multiple overloads with `CASCADE`, recreates mutation RPCs, and intends to restrict execution to `service_role` and `postgres`. This is a high-impact migration: dropping with CASCADE can remove dependent objects. Before replay, enumerate dependencies and verify the deployed signature/grants and every application/worker caller. Never apply this to production merely because it exists in Git.

The `request_withdrawal` body accepts a `p_user_id` argument and uses a SECURITY DEFINER function. Its service-role-only grants are a meaningful boundary only if untrusted clients cannot invoke the service-role key and server code correctly binds the requested user to the authenticated session. Confirm all call sites do not expose arbitrary user IDs through a privileged server endpoint.

### Admin authorization RPC history contains a conflicting earlier implementation
The earlier `20261003030000_fix_admin_authorization_rpcs.sql` authorizes based partly on a hard-coded email allowlist and grants `verify_admin_login` / `check_is_admin` to PUBLIC and anon. The later `20261003040000_fix_admin_authorization_rpcs.sql` removes the email allowlist and revokes PUBLIC/anon execution. The later version appears to correct those specific issues in source, but the migration history and live grants must be verified. Do not assume that the later file was applied in production.

### Admin identity arguments need contextual review
The later admin-check functions accept optional user UUID arguments and allow authenticated execution. The functions return authorization status rather than performing a sensitive mutation themselves, but any server-side authorization decision must derive the caller from `auth.uid()` or trusted server context—not blindly trust a caller-supplied UUID. Trace frontend/server callers and ensure privileged operations independently enforce authorization.

### SECURITY DEFINER search paths
Reviewed functions generally pin `search_path` to explicit schemas, including `pg_temp` last in newer definitions. Continue checking every privileged function for pinned paths, unsafe dynamic SQL, overly broad grants, and correct ownership. A safe search path alone does not establish safe authorization.

## Verification status
- Static source inspection only.
- No build, SQL parser, staging replay, RPC integration test, or live grant check was run in this step.
- Production remains schema-divergent from repository migrations, so migration applicability is not established.
- No production financial rows read or modified; no staging DDL; no live coins; no merge/deploy.

## Required follow-up
1. Trace callers for each sensitive RPC and confirm user identity is server-derived.
2. Compare deployed function definitions, owners, dependencies, and grants using read-only catalog inspection.
3. Reconcile the actual production schema with the migration contracts before considering any migration.
4. Test failure atomicity: force ledger insert failure in disposable staging and assert all balance/status changes roll back.
5. Test restricted/banned users, forged user IDs, unauthenticated/anon calls, and concurrent withdrawals.
6. Resolve historical migration order without rewriting applied production migration history.
