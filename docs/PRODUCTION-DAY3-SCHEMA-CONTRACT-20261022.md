# Paxones — Day 3 Production Schema Contract Audit
Date: 2026-10-22

## Changes made locally

- Added GET/PUT /api/admin/branding. It reads and writes the deployed app_settings table through the server-side service-role client; writes require verifyServerAdmin. Branding JSON is serialized into the existing value TEXT column and input keys/types/size are validated.
- Updated the branding context and admin appearance editor to use the API instead of querying the nonexistent app_config table from the browser.
- Updated admin metrics to count unresolved rows in the deployed system_alerts table.
- Updated financial reconciliation to persist alerts in system_alerts using its actual metadata JSONB column instead of the absent security_alerts.details column.
- Updated the backup table list from the absent app_config and crypto_deposit_addresses names to existing app_settings and deposit_addresses.
- Added migration 20261022041632_add_crypto_deposit_address_sets.sql with a constrained 1–20 set ID, JSON-object validation, RLS, and admin-only authenticated policy.
- Added tests/production-schema-contract-branding-alerts.test.ts to guard the API/table mappings and the new migration's RLS contract.

## Verification

- npm run typecheck: passed, exit code 0.
- Migration contract tests: 18 passed, 0 failed.
- Migration version preflight: 133 files, 133 unique valid version prefixes.
- Targeted /my-ads regression tests: 7 passed, 0 failed.
- Production schema-contract test: 1 passed, 0 failed.
- git diff --check: passed; only existing LF/CRLF warnings.

## Production schema facts checked read-only

- Production project paxonesflows (eaiwgfxoiwxepinvcykg) has 80 public base tables, 0 public tables with RLS disabled, 145 public SECURITY DEFINER routines, and 81 migration-ledger rows.
- app_settings.value is TEXT and the table is RLS-protected with service-role-only policy; the new API keeps service-role access server-side.
- system_alerts exists and has alert_type, severity, title, message, metadata, and is_resolved.
- The production database does not contain platform_wallets even though a local migration creates it and application code expects custody address fields. admin_main_wallets is not a safe replacement because it only stores currency and balance, not network/address/custody details.
- crypto_deposit_addresses is referenced by the admin rotating-address-set page and was absent from production. A new local migration now creates it with an admin-only RLS policy; the migration has not been applied to any database. The live deposit_addresses table is user-specific and is not semantically equivalent to rotating address-set configuration.
- The production migration ledger's 81 versions still do not map to the local 133-file migration chain. Do not apply local migrations to production or mark versions applied to hide this mismatch.

## Remaining release blockers

1. Recover the exact SQL/version mapping for production migrations and rehearse on a disposable schema-matched PostgreSQL database.
2. Execute and verify the new rotating address-set migration in an isolated schema-matched PostgreSQL database. Do not apply it to production until migration reconciliation is complete.
3. Reconcile the missing production platform_wallets table and review its custody/address schema without substituting balance-only tables.
4. Complete authenticated ad edit/pause/resume/delete tests with disposable test data.
5. Complete SECURITY DEFINER, RLS, financial ledger/escrow, and isolated rollback/idempotency tests.

No production database changes, commit, push, deploy, or GitHub Actions run occurred. The work remains local and uncommitted. Static checks do not establish production readiness.
