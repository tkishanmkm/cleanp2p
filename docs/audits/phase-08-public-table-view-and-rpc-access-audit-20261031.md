# Phase 08 — Public table, view and RPC access audit (2026-10-31)

## Summary

Read-only review of public table grants, RLS policies, public views and functions executable by anon/authenticated. Two unnecessary read surfaces were identified and prepared as local-only migration candidates. No production or staging changes were made.

## 1. Confirmed system_settings overexposure

Production public.system_settings currently has:
- A SELECT policy named system_settings_select_policy, role public, USING (true).
- Table-level SELECT privilege for anon and authenticated.
- An additional broad ALL policy for admin mutation and a deny-all policy. PostgreSQL permissive policies combine with OR, so the SELECT USING (true) policy makes the deny-all policy ineffective for reads.
- Eight current rows. The key names are emergency_mode, maintenance_mode, prevent_new_ads, prevent_new_signups, prevent_new_trades, prevent_transfers, prevent_user_login, and prevent_withdrawals. Metadata inspection found JSON boolean values only; actual values were not read.

This is unnecessary disclosure of global operational-control state and creates an unsafe default for future keys. It is not evidence that secrets are currently stored in the table.

Existing local migration candidate: supabase/migrations/20261031110000_lock_down_system_settings_access.sql. It removes the broad policies and public writes, retains only column-level key/value SELECT for anon/authenticated and filters that SELECT to emergency_mode, maintenance_mode and prevent_user_login. Service role retains full SELECT/INSERT/UPDATE/DELETE.

Code compatibility verified:
- src/middleware.ts reads only those three flags using key/value.
- src/lib/platform-settings.ts uses getSupabaseAdminClient() and still reads all eight feature controls server-side.
- The same service-role client handles all_ads_paused_at and admin updates.
- The admin settings API reads through the server-side settings helper.

The system-settings regression test was expanded to verify that split. It passed.

## 2. Additional admin view with unnecessary client grants

Production public.admin_financial_overview is a view with security_invoker=true, but currently grants SELECT to anon and authenticated. Its definition aggregates wallet balances, sweep totals, withdrawal fees, P2P fee totals and pending withdrawals.

Because it is security_invoker, underlying table RLS applies; the audit did not establish a cross-user data leak from this view. However, public application source has no call site for this view, and it is an administrative financial aggregate. Public client grants are unnecessary.

New local-only candidate: supabase/migrations/20261031170000_restrict_admin_financial_overview_view.sql. It revokes all view privileges from PUBLIC, anon and authenticated and grants SELECT only to service_role. It does not alter or recreate the view.

New static regression test: tests/admin-financial-overview-access.test.mjs. Passed.

## 3. Broader public-schema result

- 72 public tables currently grant SELECT to anon; all returned tables have RLS enabled. This is not, by itself, proof of exposure; the applicable row policies remain decisive.
- 11 SELECT policies use unconditional USING (true). Reviewed examples include public ad listings, assets, market prices, feedback, network gas fees, payment methods and the system_settings table. The other public-read categories appear intended for marketplace/reference data; no changes were made without a data-classification and client-use review.
- public.profiles has a public SELECT policy but no SELECT table privilege for anon or authenticated in the live catalog.
- public.withdrawal_limits has an authenticated-only unconditional SELECT policy; it is not an anon policy.
- No anon-executable SECURITY DEFINER function was found in the prior function ACL scan. The 43 functions callable by anon in this inventory are SECURITY INVOKER; their data access remains subject to table grants and RLS.
- The five public views have security_invoker=true. admin_financial_overview was singled out due to its administrative financial aggregate and lack of application usage.

## 4. Regression verification

- system-settings-access-hardening.test.mjs: passed; verifies middleware allowlist and service-role access to all eight controls.
- admin-financial-overview-access.test.mjs: passed; verifies removal of anon/authenticated view grants and service-role-only SELECT.
- Migration preflight: 173 migration files, 173 unique valid prefixes.
- git diff --check: passed (existing Git LF-to-CRLF normalization warnings only).

## 5. Release and non-actions

Production system_settings and admin_financial_overview privileges remain unchanged; both migrations are local candidates only. The public-settings exposure has no secret-valued rows in the inspected snapshot, but the broad policy should still be removed before launch.

No production/staging SQL was executed, no rows or values from financial ledgers were read, no Git commit/push/merge/deployment occurred, no GitHub Actions workflow ran, and no paid resources were created.

Production and staging migration ledgers were last checked at 81 and 0 respectively. Staging still lacks a schema-faithful baseline, so runtime SQL authorization tests remain a release gate.
