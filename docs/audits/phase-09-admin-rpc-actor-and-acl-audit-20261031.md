# Phase 09 — Privileged admin RPC and actor-attribution audit (2026-10-31)

## Summary

Reviewed production ACLs and deployed definitions for emergency mode, individual freeze/unfreeze, and bulk ban/restrict/unban/unrestrict RPCs. Verified the app's actual call paths and hardened the local audit-actor candidate. Production and staging were not modified.

## 1. Production ACL findings

Read-only production catalog inspection found:

- `admin_set_emergency_mode(boolean,text)`: executable by authenticated and service_role; not anon.
- `admin_freeze_user(uuid,text)` and `admin_unfreeze_user(uuid,text)`: executable by authenticated and service_role; not anon.
- `execute_bulk_ban_atomic`, `execute_bulk_unban_atomic`, `execute_bulk_restrict_atomic`, and `execute_bulk_unrestrict_atomic`: all four are executable by authenticated and service_role; not anon.

The four bulk RPCs perform whole-platform account-status transitions and restoration. Their direct authenticated EXECUTE grant is unnecessary because the app calls them through a verified server route. Local candidate `20261026131000_restrict_bulk_account_control_rpc_acl.sql` revokes PUBLIC/anon/authenticated and grants only service_role and postgres.

The individual freeze/unfreeze and emergency-mode paths are intentionally different: local candidates retain authenticated execution because the app invokes them with the authenticated user's Supabase session and the function binds the actor to auth.uid(). Those candidates remove the service-role bypass.

## 2. Call-path audit

Verified source references:

- The only application call site for the four bulk RPCs is `src/lib/platform-bulk-actions.ts`.
- The helper is imported by `src/app/api/admin/platform-controls/bulk/route.ts`.
- The route calls `verifyServerAdmin(req)`, rejects unauthorized callers and explicitly rejects support administrators before dispatch.
- The route derives admin ID/email from the verified auth result, not from request-body identity fields.
- Freeze/unfreeze are called only from the admin server actions using `createClient()` user sessions.
- Global emergency mode is called from the admin settings API using `createClient()` user session; support admins are explicitly denied.
- No additional app RPC invocation was found in the source scan.

## 3. Audit-attribution correction

The bulk route previously substituted the literal `admin@paxones.com` when the verified user had no email. That could create a misleading audit actor email.

Local correction:
- The route now passes an empty string when the verified auth result has no email; it does not invent a person/email identity.
- The local bulk actor migration now requires a non-null explicit actor UUID for service-role execution.
- It prefers the matching profile's canonical email.
- A supplied email that conflicts with a non-null canonical profile email is rejected.
- If the profile email is empty, the route's verified user email can be retained as a fallback.
- Authenticated execution, if reached before ACL tightening, must match p_admin_id to auth.uid() and must not mismatch the verified email.

The canonical email column on production profiles is nullable, and admin_audit_logs.admin_email is nullable, so no fabricated address is required.

## 4. Production function rewrite dry-run

A read-only SQL simulation applied the same definition-splitting, declaration injection, parameter substitution and guard insertion logic to all four current production bulk RPC definitions.

All four matched:
- Expected `AS $function$` body delimiter.
- Closing delimiter present.
- Original actor parameter references replaced in the original function body.
- Exactly one injected authorization/audit guard.
- Canonical profile-email validation present.
- No function definitions were replaced or executed.

## 5. Regression verification

- Focused security/migration tests: 24 passed, 0 failed.
- `npm run typecheck`: passed.
- Migration preflight: 173 files, 173 unique valid versions.
- `git diff --check`: passed; Git emitted only existing LF-to-CRLF normalization warnings.

The bulk actor tests now verify canonical email preference and ensure the route uses verified identity, blocks support-admin bulk execution, and does not trust body-supplied actor fields.

## 6. Release gate and non-actions

The production functions still have the current ACLs described above; the local migrations have not been applied. PostgreSQL runtime behavior still needs rehearsal on a schema-faithful disposable/staging database. The existing staging project is still an empty-schema project and is not suitable for replaying these migrations.

No production or staging SQL/DDL/DML was executed. No commit, push, merge, deploy, or GitHub Actions workflow occurred. No paid infrastructure was created.
