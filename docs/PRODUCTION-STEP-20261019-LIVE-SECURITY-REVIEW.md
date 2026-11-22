# Production Readiness Step — 2026-10-19

## Scope completed
- Read-only inspected the active Supabase project `paxonesflows` (`eaiwgfxoiwxepinvcykg`) and its migration history.
- Read-only checked Supabase Security and Performance Advisors.
- Reviewed local prepared migrations for `verify_admin_login`, trade-RPC metadata trust, public ad reads, chat guards, active-ad limits, and offline-ad handling.
- Ran 13 local migration-contract/security tests: all passed.
- Ran the 2FA Edge/Node session test: passed.

## Live database findings (read-only)
1. Production/stable project migration history currently ends at version `20261016013425`; local migrations dated 2026-10-17 through 2026-10-19 are not recorded as applied. Do not assume their protections are live.
2. Supabase Security Advisor reports 18 `SECURITY DEFINER` functions executable by `authenticated`, including admin operations, trade lifecycle RPCs, KYC initiation, `verify_admin_login`, and `initiate_trade_with_escrow`. Some may intentionally be client-callable with internal authorization; each function's identity checks and grants must be validated before changing ACLs.
3. Live `verify_admin_login(p_user_uuid, user_uuid)` accepts caller-supplied UUID parameters and its current body checks role flags for that target without requiring the target to match `auth.uid()`. This allows signed-in callers to probe other users' admin status/role. Local mitigation exists in `20261019110000_harden_verify_admin_login_identity.sql`, but it is not applied live.
4. Security Advisor reports three tables with RLS enabled and no policies: `user_2fa_pending_enrollments`, `user_2fa_recovery_codes`, and `user_security_audit_logs`. This is restrictive by default, not evidence of public access; verify intended service-role-only access and application flows rather than adding broad policies.
5. Security Advisor reports no additional performance lints in the current result.

## Test status
- 13 static migration-contract tests: PASS.
- `tests/2fa-session-edge.test.ts`: PASS.
- Financial integration tests (`p2p-trade-flow`, `reconciliation`, `security-verification`) were blocked before execution because the explicitly disposable test database variables are not configured. These are NOT counted as passed.
- Static checks do not prove SQL parses/executes or runtime permissions behave correctly.

## Dependency risk
- Latest `npm audit --omit=dev --audit-level=high` output: 69 production dependency findings (57 moderate, 12 high). The output includes a `uuid` advisory marked “No fix available” in the current dependency graph. Do not run `npm audit fix --force`; plan the Next.js/React and transitive dependency upgrades with regression tests.

## Next safe actions
1. Prepare a disposable PostgreSQL/Supabase test database, load the matching schema, and test migrations in order. Do not use production credentials.
2. Validate the `verify_admin_login` identity fix against anonymous, authenticated-self, authenticated-other-user, and service-role cases.
3. Review the 18 Advisor functions individually; preserve intentional authenticated RPCs only where internal identity/authorization checks are proven. Add regression tests before changing grants.
4. Re-run advisor checks and the complete quality gate after isolated SQL validation.
5. Only then request explicit approval for any production migration.

## Safety boundary
No production SQL writes, migrations, commits, pushes, merges, deployments, or real financial operations were performed in this step. The repository work remains local/uncommitted.
