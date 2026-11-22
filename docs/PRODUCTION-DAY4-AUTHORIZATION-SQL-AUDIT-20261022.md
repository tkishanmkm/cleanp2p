# Paxones — Day 4 Authorization and SQL Contract Audit
Date: 2026-10-22

## Changes made locally

- Hardened src/lib/server-admin-auth.ts: user-editable Supabase user_metadata.role can no longer grant server-side administrator privileges. Authorization accepts server-managed app_metadata flags, authoritative profiles fields, app_admins membership, or the configured ADMIN_EMAILS allowlist.
- Hardened the client auth provider so editable user_metadata.role cannot make the UI treat an account as admin.
- Added/updated tests/server-admin-auth-metadata.test.ts to guard server and client role checks.
- Retained the existing forward migration 20261019130000_remove_user_metadata_admin_trust_from_trade_rpcs.sql. Its contract checks rewrite vulnerable SECURITY DEFINER trade RPC definitions to remove raw_user_meta_data admin trust. Production read-only inspection shows raw_user_meta_data admin checks still exist in live mark_p2p_trade_paid and raise_trade_dispute definitions, so this migration is a release-critical unapplied change until exact migration history is reconciled and the SQL is tested in an isolated database.
- Added 20261022050000_restore_platform_wallets_contract.sql to recreate the expected platform custody-address registry with admin-only reads, service-role writes, RLS, and an asset/network/status index. It has not been applied anywhere.
- Corrected PlatformWalletRecord in src/lib/supabase/db.ts to match the SQL role/custody schema rather than expecting nonexistent wallet_type/current_balance fields.
- Continued the production schema contract corrections from Day 3 and the rotating-address-set table migration. No SQL was executed against production.

## Read-only production SQL findings

- The production public.is_admin() function uses app_admins and auth.users.raw_app_meta_data (server-managed) rather than raw_user_meta_data.
- Production still has legacy SECURITY DEFINER definitions for some trade RPCs that trust auth.users.raw_user_meta_data->>'role'. Since user metadata is user-editable, these checks must be removed before release.
- A review of SECURITY DEFINER functions callable by authenticated found several intended endpoints (for example trade pay/dispute) plus admin-only RPCs whose bodies do perform internal profile/app_admins checks. Static EXECUTE grants alone are not proof of exploitability; each callable routine still needs isolated authorization tests.
- No mutation test was run against production and no production SQL was changed.

## Verification run

- npm run typecheck: passed, exit code 0 after aligning the admin custody UI with the actual platform_wallets SQL fields.
- Focused regression/security contract tests: 10 passed, 0 failed.
- Migration contract tests: 18 passed, 0 failed.
- Migration version preflight: 134 files, 134 unique valid version prefixes.
- git diff --check: passed; only line-ending warnings.
- New Day 4 server/client authorization contract test passed.

## Release blockers

1. Reconcile production's 81 migration-ledger versions with the local 134-file migration chain. Exact version/SQL identity is still not established.
2. Rehearse the metadata-trust removal migration and the new crypto_deposit_addresses migration against an isolated schema-matched PostgreSQL database, including authorization checks with non-admin and admin roles.
3. Reconcile the missing production platform_wallets table and custody/address schema before changing wallet code or applying schema changes.
4. Exercise authenticated ad edit/pause/resume/delete, trade pay/dispute/cancel, escrow, deposits, withdrawals, idempotency, and rollback with disposable test data only.
5. Review all 145 production SECURITY DEFINER routines for auth checks, search_path, grants, caller-supplied identity, and atomic ledger behavior.

No commit, push, deploy, production migration, production data write, or GitHub Actions run occurred. All changes remain local and uncommitted. Static checks are not a production-readiness guarantee.
