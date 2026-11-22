# Paxones Production Audit — Privileged RPC Review (2026-10-26)

## Scope and method
Read-only queries against production project `eaiwgfxoiwxepinvcykg`, comparing live PostgreSQL function definitions and EXECUTE privileges with local migration candidates. No production data or permissions changed.

## Confirmed observations

### A. Didit KYC session initiation — configuration drift / review blocker
- Signature: `public.initiate_didit_kyc(p_user_id uuid, p_session_id text)`
- SECURITY DEFINER; EXECUTE is granted to `authenticated` and `service_role`.
- Search path is `public, pg_temp`.
- Live definition MD5 observed: `bb37799ee0276dc83df0c16196155eeb`.
- Catalog pattern checks found `auth.uid()` usage but did not find a direct parameter-to-session identity comparison. This is not a complete semantic proof; full function logic must be reviewed and tested.
- Local candidate `20261018100000_restrict_didit_kyc_rpc_execution.sql` revokes authenticated access and sets an empty search path. It has not been applied.

### B. 2FA status RPC — identity guard present, regression tests needed
- Signature: `public.get_user_2fa_status(p_user_id uuid DEFAULT NULL)`
- SECURITY DEFINER; EXECUTE is granted to `authenticated` and `service_role`.
- Search path is `public, auth, pg_temp`.
- Live body rejects a non-service-role caller querying another user's ID unless `public.is_admin()` passes. When the parameter is omitted, it uses `auth.uid()`.
- This body contains an explicit cross-user check. Verify that `public.is_admin()` is safe under this SECURITY DEFINER context and that unauthorized requests fail under real JWT/session contexts.

### C. Admin role update RPC — explicit caller/admin check observed
- Signature: `public.admin_update_user_role(p_admin_id uuid, p_target_user_id uuid, p_new_role text)`
- SECURITY DEFINER; EXECUTE granted to authenticated and service_role; empty search path.
- Live body derives the caller from `auth.uid()` and requires service_role or a non-null authenticated caller passing `public.is_admin()`. It does not use the supplied `p_admin_id` to authorize an authenticated caller. It prevents self-role modification when a session UID is present.
- Still requires tests for `public.is_admin()` trust source, service-role attribution, and role-change audit integrity.

### D. Bulk account controls — grants and identity attribution need adversarial validation
- `execute_bulk_ban_atomic`, `execute_bulk_unban_atomic`, `execute_bulk_restrict_atomic`, `execute_bulk_unrestrict_atomic` are SECURITY DEFINER and executable by authenticated and service_role.
- The inspected ban/restrict/unban bodies derive authenticated identity from `auth.uid()` and look up the caller profile for admin flags; service-role branch trusts the supplied admin ID/email for audit attribution. This is a trusted-backend pattern, but service-role caller validation and accurate audit attribution must be verified at the API boundary.

### E. Trade lifecycle RPCs
- `initiate_trade_with_escrow`, `mark_p2p_trade_paid`, and `raise_trade_dispute` are SECURITY DEFINER and executable by authenticated and service_role.
- They accept caller-supplied identity parameters. The local migration `20261019100100_restrict_trusted_caller_id_fallback_to_service_role.sql` attempts to restrict no-session fallback to service-role execution; production definition hashes and migration ledger must be reconciled before treating it as deployed.

## Recommended next tests
1. Use two isolated test users A and B. Verify A cannot initiate KYC for B, read B's 2FA status, mark B's trade paid, raise a dispute as B, or start a trade as B.
2. Verify unauthenticated/anon requests fail; verify authenticated self-service succeeds only for permitted operations.
3. Verify a non-admin cannot invoke admin role/bulk status RPCs, including by supplying a real admin UUID/email.
4. Verify service-role API routes attribute actions to a verified admin actor rather than accepting arbitrary client-supplied audit identities.
5. Reconcile each live definition hash and EXECUTE grant with exact migration history before any deployment.

## Status
This is an audit report, not a remediation. No production SQL changes, no commit/push, and no deployment. Production migration history mismatch and the previously identified admin-login identity-binding issue remain release blockers.
