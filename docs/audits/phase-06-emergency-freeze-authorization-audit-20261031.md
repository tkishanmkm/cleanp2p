# Phase 06 — Emergency freeze/unfreeze authorization contract audit (2026-10-31)

## Production observation (read-only)

Live production exposes:

| RPC | anon EXECUTE | authenticated EXECUTE | service_role EXECUTE |
|---|---:|---:|---:|
| `admin_freeze_user(uuid,text)` | No | Yes | Yes |
| `admin_unfreeze_user(uuid,text)` | No | Yes | Yes |

The authenticated grant is intentional: `src/app/adminnarayan/users/actions.ts` first calls `verifyServerAdmin()`, then invokes these RPCs through `sessionSupabase.rpc(...)` so the database can bind the acting administrator and audit row to `auth.uid()`. Do **not** revoke the authenticated grant without changing the application contract.

The currently deployed SECURITY DEFINER bodies are older. They contain a service-role shortcut (`auth.role() = 'service_role' OR current_setting('role', true) = 'service_role'`) and authorize authenticated users from the profile admin flags. That shortcut permits privileged server-role calls without an authenticated actor UUID, which can weaken actor attribution in the admin audit trail.

## Local hardening candidate

Existing local migration:
`supabase/migrations/20261026124500_harden_emergency_freeze_actor.sql`

It:
- requires a non-null `auth.uid()`;
- checks administrator membership using the server-managed profile flags and `public.app_admins`;
- rejects non-admin sessions and prevents an administrator freezing their own account;
- validates a nontrivial freeze reason and confirms the target row was updated;
- uses the authenticated user's identity/email for audit attribution;
- removes the service-role bypass from both RPC bodies;
- revokes EXECUTE from `PUBLIC`, `anon` and `service_role`, while explicitly granting EXECUTE to `authenticated` and `postgres`.

The production schema has the expected `public.app_admins` columns (`user_id uuid NOT NULL`, `granted_at timestamptz)); the table is owned by `postgres`, RLS is enabled, and FORCE RLS is off. This confirms the dependency exists, but it does not replace SQL replay/runtime testing.

## Verification

- `npx tsx --test tests/emergency-freeze-actor-migration.test.ts`: **1 test passed**.
- Static test confirms the authenticated actor is required, service-role bypass is removed, and application call sites use the user session.
- Production function definitions and ACLs were queried read-only.
- No runtime SQL test has been run against a disposable schema-matched database.
- The migration version `20261026124500` is not in the current production migration ledger (which ends at `20261016013425`).

## Release decision

This is a **local hardening candidate pending staging replay**, not a deployed production fix. It must be tested with:
- an authenticated non-admin session (must be rejected);
- an authenticated `app_admins` member (must succeed);
- an administrator attempting self-freeze (must be rejected);
- service-role/no-user-session invocation (must be rejected);
- audit-row actor ID/email correctness;
- unfreeze behavior and preservation of unrelated account status flags.

No production or staging changes were made during this audit.
