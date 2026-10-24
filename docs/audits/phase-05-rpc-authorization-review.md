# Phase 05 — Production RPC authorization review

Date: 2026-10-24  
Target: production Supabase project. Read-only inspection only.

## Highest-priority findings

### `public.mark_p2p_trade_paid(uuid, uuid, text)`
- SECURITY DEFINER; EXECUTE granted to authenticated and service_role, not anon.
- The deployed authorization predicate accepts `auth.users.raw_user_meta_data->>'role' = 'admin'`. This metadata is user-editable and must not be trusted for authorization.
- If `auth.uid()` is NULL, the function falls back to the supplied caller ID. Confirm runtime role/JWT context and fail closed for ordinary client requests without a verified UID.
- Recommended fix: remove the user-editable metadata check, derive normal client identity only from `auth.uid()`, keep participant checks, and retain a clearly separated trusted service-role path.

### `public.raise_trade_dispute(uuid, uuid, text)`
- SECURITY DEFINER; EXECUTE granted to authenticated and service_role, not anon.
- Its admin predicate also trusts user-editable `raw_user_meta_data` role. This is unsafe as an authorization source.
- It has a supplied-user-ID fallback when `auth.uid()` is NULL; verify that this cannot be reached by untrusted client context.
- Recommended fix: remove user-editable metadata authorization, require verified session identity for ordinary clients, preserve participant validation and service-role behavior.

## Additional review queue

| Function | Observation | Follow-up |
|---|---|---|
| `verify_admin_login(uuid, uuid)` | Accepts a selected UUID before falling back to the session UID; authenticated EXECUTE granted. | Trace all callers; ensure a result for another UUID is never treated as proof that the current session is an admin. |
| `initiate_didit_kyc(uuid, text)` | Requires target UID match when a session UID exists; null-UID path is intended for service role. | Test actual PostgREST role/JWT context in isolation. |
| `get_user_2fa_status(uuid)` | Has self-check and separate admin/service-role path for other users. | Test self, non-owner, admin, and service-role cases. |
| `admin_update_user_role(uuid, uuid, text)` | Uses `auth.uid()` and `public.is_admin()` rather than trusting the supplied admin ID. | Preserve this pattern; test role changes, self-demotion and ordinary-user rejection. |
| `cancel_p2p_trade`, `initiate_trade_with_escrow` | Financial SECURITY DEFINER functions include identity fallback logic. | Trace application call sites and full contracts before changing behavior. |

## Positive controls

- Reviewed functions generally set explicit search paths; some use an empty search path with schema-qualified relations.
- `public.is_admin()` derives identity from `auth.uid()` and checks `app_admins` and app metadata, not user-editable metadata.
- The reviewed role-update function derives the caller from the authenticated session.

## Remediation sequence (not applied)

1. Build isolated regression tests for forged user-editable admin metadata, null UID, mismatched IDs, non-participants, valid buyer, valid admin, and service-role calls.
2. Trace both affected RPCs to all app call sites and preserve the expected response contract.
3. Prepare a narrow reviewed migration removing the unsafe metadata checks and requiring verified identity for normal clients.
4. Validate against an initialized isolated database. Staging is currently uninitialized, and migration-history drift from Phase 03 remains unresolved.
5. Review `verify_admin_login` consumers before changing its contract; do not blindly revoke every authenticated grant.
6. Plan production rollout and rollback separately after isolated tests pass.

## Guardrails and status

No production writes, grants, policies, migrations, merges, deployments, or GitHub Actions jobs were performed. No authenticated API exploit test was run; these are source-level authorization findings based on live function definitions and grants.

**Status: high-priority authorization review documented; remediation not applied. Production readiness remains unverified.**
