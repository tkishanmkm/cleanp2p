# Phase 10 — Server-mediated admin trade RPC and 2FA audit (2026-10-31)

## Result

Completed a local authorization hardening pass for participant trade mutations and administrator mark-paid. Production was inspected read-only; no database migrations or writes were applied.

## Production findings

The live production catalog showed authenticated EXECUTE grants on three SECURITY DEFINER participant RPCs:

- public.cancel_p2p_trade(uuid,uuid,text)
- public.mark_p2p_trade_paid(uuid,uuid,text)
- public.raise_trade_dispute(uuid,uuid,text)

These functions support participant actions but also contained administrator exceptions. The admin exception was based on in-function administrator predicates, including user-editable Auth metadata in the live mark-paid and dispute definitions. A signed-in admin could therefore call an admin exception directly through the Data API, bypassing the application's signed Admin 2FA cookie check.

A live definition dry-run found exactly one administrator predicate in each of the three functions. Replacing those predicates with a service-role-only JWT check matched the three live function definitions and removed the user-editable metadata references from the resulting definitions. No live function was altered.

## Local implementation

### Participant flows

Added migration candidate:

supabase/migrations/20261031111719_require_server_mediated_admin_trade_actions.sql

The candidate dynamically patches the three currently deployed RPC definitions using pg_get_functiondef, fails closed if any signature or predicate has drifted, and leaves normal participant flows executable by authenticated sessions. Its admin exception is available only to a request carrying the trusted service-role JWT.

The P2P payment route now performs an explicit authenticated-buyer check against the trade row before calling mark_p2p_trade_paid. The production trades table grants authenticated SELECT and its trades_select_policy permits the buyer or seller to read their own trade. The participant pay path is therefore compatible with the existing table access model.

### Administrator mark-paid

The browser helper src/lib/admin.ts no longer calls mark_p2p_trade_paid directly. It calls the existing server-side moderator API with action=mark_paid.

That route:
- runs verifyServerAdmin(req) before the mutation, including the signed Admin 2FA cookie;
- denies support-admin sessions;
- obtains actor ID and email from the verified auth result, not request-body fields;
- requires a 10–1000 character reason;
- invokes the server-only admin_mark_trade_paid_authorized RPC; and
- requires both the database success result and audit_logged=true before reporting success.

The new wrapper is SECURITY DEFINER, restricted to service_role/postgres, verifies the trusted service-role JWT, resolves the administrator's canonical email from auth.users, rejects a conflicting supplied email, locks the trade, invokes the canonical mark-paid transition, and writes an ADMIN_MARKED_TRADE_PAID row to admin_audit_logs in the same database transaction. It explicitly casts the deployed text buyer_id to UUID for the audit table's UUID target_user_id column.

### 2FA for server actions

The review also found that Server Actions call verifyServerAdmin() without a NextRequest. Previously that meant the helper had no request cookie source for its signed Admin 2FA token.

src/lib/server-admin-auth.ts now obtains the request-scoped Next.js cookie store with cookies() when no NextRequest is supplied, and validates the same HMAC token and security-version claim. API routes continue to use NextRequest.cookies. Missing request cookie context fails closed.

The five user-management actions now explicitly reject support-admin sessions before account role, suspension, ban, freeze, or unfreeze actions. Freeze/unfreeze now call the new service-role-only database entry points with actor identity from verified server auth.

Global emergency-mode writes were also moved to a service-role-only wrapper behind verifyServerAdmin(req), with the verified actor passed for audit. The old authenticated entry point is revoked in the local candidate migration. The admin role-update function's authenticated EXECUTE grant was also removed in its local candidate migration.

## Validation

- Focused tests: 20 passed, 0 failed.
- npm run typecheck: passed.
- Migration preflight: 174 migration files, 174 unique valid prefixes.
- git diff --check: passed. Git emitted existing LF-to-CRLF normalization warnings only.
- Live SQL simulation: exactly one admin predicate matched and was replaced for each of the three target participant RPCs.
- Live schema compatibility checked: trades.buyer_id is text; admin_audit_logs.target_user_id is UUID; auth.users.email exists; the participant trades SELECT policy allows buyer/seller reads.

No financial rows were inspected. Production currently has zero rows in public.trades; the type-conversion check therefore did not need to inspect any buyer identifiers.

## Remaining advisor and release gates

The production Supabase security advisor still reports 18 SECURITY DEFINER functions with authenticated EXECUTE. Not all are defects: some are user-scoped or participant flows and must be reviewed individually. This phase reduces the high-impact administrator paths but is not a blanket resolution of all 18 findings. The three tables user_2fa_pending_enrollments, user_2fa_recovery_codes, and user_security_audit_logs have RLS enabled with no policies; preserve that closed posture until their application access contract is checked.

The production Performance advisor also reports five unindexed foreign keys and 38 auth-RLS initplan warnings. Those are separate follow-up performance work.

The current staging project still has no schema-faithful migration baseline, so these SQL candidates have not been replayed against an isolated staging schema. Do not apply them directly to production. Rehearse the entire pending migration chain and test participant, full-admin, and support-admin behavior before release.

No production or staging SQL/DDL/DML was executed. No commit, push, merge, deployment, GitHub Actions workflow, or paid resource was created.
