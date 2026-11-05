# Paxones Production Audit — Caller and Regression Check (2026-10-26)

## Work performed
- Enumerated local call sites for privileged KYC, trade, dispute, payment, bulk-admin and role-change RPCs.
- Read the KYC initiation API route around authentication, target-user selection and atomic RPC invocation.
- Inspected the live production `public.is_admin()` definition and EXECUTE metadata using read-only SQL.
- Ran focused local regression tests covering KYC grant migration contract, trusted-caller fallback migration, bulk-admin actor migration/route identity and 2FA session edge cases.

## Results

### 1. KYC caller path is server-mediated in the inspected route
`src/app/api/kyc/initiate/route.ts` authenticates the request, defaults the target to the authenticated user, and requires `verifyServerAdmin(req)` if a different target user is requested. It then invokes `initiate_didit_kyc` through `getSupabaseAdminClient()` after obtaining a provider session. This supports the local candidate migration's intended service-role-only execution model for this route. It does not establish that no other caller exists, nor does it replace live runtime tests.

### 2. Live `is_admin()` source
- SECURITY DEFINER; EXECUTE available to authenticated.
- Search path: `public, auth, pg_temp`.
- Definition MD5: `dda92ee209e64f1daecdc716d77e5e5d`.
- The body checks `auth.uid()` and queries `public.app_admins` and `auth.users.raw_app_meta_data` for admin flags. It also returns true for `auth.role() = 'service_role'`.
- The inspected body uses schema-qualified relations and auth functions. Its trust in `raw_app_meta_data` should be checked against who can modify app metadata and reconciled with the canonical admin-login verifier, because differing admin sources can create inconsistent authorization decisions.

### 3. Focused local tests
Command:
`npx tsx --test tests/restrict-didit-kyc-migration.test.ts tests/trusted-caller-fallback-migration.test.ts tests/bulk-admin-audit-actor-migration.test.ts tests/bulk-admin-route-identity.test.ts tests/2fa-session-edge.test.ts`

Result: **8 passed, 0 failed**. These are local static/contract tests, not production integration tests and not proof that live grants match the migrations.

## Still blocked
- Production `initiate_didit_kyc` still permits authenticated EXECUTE; the restrictive candidate migration remains unapplied.
- The admin-login identity-binding issue and production/local migration-history mismatch remain unresolved.
- No schema-faithful isolated database is available for end-to-end adversarial tests.
- Need a full inventory of admin sources (`app_admins`, profile flags, `raw_app_meta_data`, canonical `verify_admin_login`) and an explicit policy for which source is authoritative before changing `is_admin()`.

## Safety
Read-only production queries only. No production changes, commits, pushes, or deployments. Existing local working-tree changes were preserved.
