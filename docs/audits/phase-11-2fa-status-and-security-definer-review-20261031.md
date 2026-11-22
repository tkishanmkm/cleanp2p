# Phase 11 — 2FA status consistency and remaining SECURITY DEFINER review (2026-10-31)

## Result

Completed a local-only security pass. Production catalog, function definitions, function grants, and column-level profile grants were inspected read-only. No production or staging database changes were executed.

## 2FA status correctness

The live public.get_user_2fa_status(uuid) RPC selected the first non-NULL value using COALESCE(is_2fa_enabled, is_mfa_enabled, two_factor_enabled, false). The production profile columns have defaults of false, while the application considers 2FA enabled when any of the three flags is true. A false value in the first column could therefore mask a true value in a legacy flag and report the wrong state.

Added supabase/migrations/20261031113546_align_user_2fa_status_flag_logic.sql:
- computes enabled status as the OR of the three current/legacy flags;
- preserves the existing self-only behavior for ordinary authenticated users;
- preserves the admin/service-role exception for another user's boolean status;
- keeps the return value limited to a boolean;
- uses an empty search path; and
- revokes PUBLIC/anon execution while retaining authenticated and service-role use.

Added tests/user-2fa-status-flag-logic-migration.test.mjs.

## Escrow RPC search-path ordering

The local chain already contains 20261019120000_harden_trade_escrow_rpc_search_path.sql, which sets the canonical escrow RPC to search_path = ''. However, later 20261031160000_harden_live_trade_ad_limits_and_payment_methods.sql dynamically runs a CREATE OR REPLACE definition produced by pg_get_functiondef. That replacement can restore the previous public, pg_temp function setting.

Updated the later migration to re-apply ALTER FUNCTION ... SET search_path = '' after the dynamic replacement. Updated tests/security-definer-search-paths-migration.test.ts to check the initial lockdown and the post-replacement re-assertion.

The escrow RPC intentionally retains authenticated EXECUTE because it is the participant-facing atomic trade/escrow creation operation. The live definition binds an authenticated request to auth.uid() and rejects a mismatching supplied caller ID. Anon EXECUTE is false, public-schema CREATE is denied to anon/authenticated, and the application API/server-action callers checked here authenticate first and pass the verified user.id as p_caller_id.

The currently unused src/lib/services/escrowService.ts helper previously used a service-role client without providing the mandatory caller ID, causing the RPC's unauthenticated path to reject it. It now gets the actual request user with createClient().auth.getUser(), fails closed without a session, uses the user ID for the platform guard, and sends that verified ID as p_caller_id. No caller ID is accepted from helper arguments. Added tests/escrow-service-auth-context.test.mjs.

## Remaining SECURITY DEFINER findings — disposition

- Admin mutation RPCs and the administrator branches of participant trade RPCs are handled by earlier local candidates from Phases 7–10. Admin actions remain server-mediated, signed-2FA gated, and audited.
- initiate_didit_kyc(uuid,text) has an existing local candidate which revokes PUBLIC/anon/authenticated and grants service_role/postgres only. Its API caller authenticates the user, restricts cross-user initiation to verified admins, and calls it with the server client.
- get_my_kyc_info() is self-scoped and only returns the authenticated user's own KYC information/limits; it remains SECURITY DEFINER because it uses service-only helpers and must safely read protected profile data.
- is_admin() returns the current caller's authorization boolean and is used by RLS policies; it does not accept an arbitrary user ID. It remains callable for policy evaluation.
- get_user_2fa_status(uuid) returns only a boolean and enforces self/admin/service-role targeting; its flag calculation is corrected in this phase.
- get_emergency_mode() is converted to SECURITY INVOKER in the local advisor-remediation candidate. The system-settings candidate grants only the allowlisted operational flag columns and read rows required for this function.
- initiate_trade_with_escrow(...) remains authenticated for signed-in participants, with caller-ID binding and atomic financial validation. Its empty search path is reasserted after the later dynamic function replacement.

The advisor's authenticated-EXECUTE warnings remain visible in live production until the pending migration chain is rehearsed and applied. They should not be cleared by blanket revocation because several are required participant/RLS/self-service entry points.

## Profile exposure check

The live profiles SELECT policy is broad, but table-level SELECT is revoked and column-level grants expose only marketplace/profile-display metrics. Sensitive name/email, address, KYC lifecycle, wallet-address, admin, and 2FA columns are not granted to anon/authenticated. No blanket profile PII disclosure was confirmed by this catalog check.

## Validation and release status

- 2FA, escrow-helper, Didit, search-path, and live-advisor migration contract tests: run in this phase; see terminal results.
- TypeScript typecheck and migration version preflight: run in this phase; see terminal results.
- Production and staging SQL remained read-only.
- No commit, push, merge, deployment, GitHub Actions workflow, or paid resource was created.
- Staging still lacks a schema-faithful baseline. The full pending migration chain has not been replayed and end-to-end participant/admin/support-admin regression tests remain a release gate.