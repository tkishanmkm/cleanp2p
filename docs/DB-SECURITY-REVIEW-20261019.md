# Database security review — 2026-10-19

Scope: read-only inspection of the connected `paxonesflows` Supabase project and local Paxones repository. No live SQL writes, migrations, account changes, or financial operations were performed.

## Findings

### High priority: admin-login RPC accepted a caller-supplied target UUID

The live `public.verify_admin_login(uuid, uuid)` SECURITY DEFINER function currently resolves the target from supplied UUID arguments before checking the target's admin flags. Its execute privilege is granted to `authenticated`. This lets a signed-in user probe whether another account is an administrator; it does not by itself prove the caller can become an administrator, but it exposes privileged-account status and is unsafe for an authentication helper.

Local mitigation prepared in `supabase/migrations/20261019110000_harden_verify_admin_login_identity.sql`:
- Authenticated users may only check the UUID matching `auth.uid()`.
- Anonymous callers receive an authentication-required result.
- Only the service role can inspect an explicitly supplied target UUID.
- The existing admin login UI passes `user_uuid: data.user.id`, which is compatible with the new identity guard.

Status: local migration only; not applied to Supabase. Needs isolated database execution tests before approval/deployment.

### High priority: public profile access model needs reconciliation

Live catalog inspection reports `has_table_privilege('anon', 'public.profiles', 'SELECT') = false` and the same for `authenticated`, even though the database has a permissive policy named `Public profiles are viewable by everyone`. RLS policies do not grant SQL table privileges; without SELECT privilege, browser/client queries to `profiles` can fail before the policy is considered.

The repository has numerous direct `.from('profiles')` reads, including client-side ad creation and dashboard flows. This should be handled as a deliberate compatibility migration—not by granting broad SELECT on the full profile row, because that table contains sensitive fields (email, date of birth, addresses, security/2FA secrets, KYC session/document metadata, deposit addresses, and admin security fields).

Recommended remediation plan:
1. Inventory every browser/client profile query and its exact required columns.
2. Move self-profile reads to authenticated server/API paths or a self-only RPC.
3. Move public trader-card reads to a narrowly allowlisted public-profile view/RPC.
4. Keep sensitive profile columns inaccessible to anon/authenticated clients.
5. Add regression tests for public profile pages, account settings, ad creation, and admin screens before changing grants.

No profile grants or policies were changed.

### Medium priority: SECURITY DEFINER RPC inventory

Supabase security advisor reports 18 SECURITY DEFINER functions executable by `authenticated`. Read-only review of several high-impact functions found explicit `auth.uid()`/admin/participant guards, so the advisor warning is not automatically an exploit. Continue reviewing each function and retain authenticated EXECUTE only where the function is intended as an API and verifies caller identity internally. `verify_admin_login` is the confirmed identity-probing case addressed by the local migration above.

### Medium priority: system settings are publicly readable

The live `system_settings_select_policy` uses `USING (true)`; the current key list contains feature/kill-switch flags such as emergency, maintenance, signup, trade, transfer, and withdrawal controls. Values are currently feature flags, not known secrets. Public read access may be intentional for client behavior, but keep secrets out of this table and review whether every key needs public visibility. Mutation policies currently include an admin check; do not weaken RLS.

### Least-privilege cleanup

Several high-risk tables grant broad SQL privileges to `anon`/`authenticated` while RLS policies appear to block unauthorized row operations. RLS remains a critical control, but unnecessary grants should be reduced after checking all API/RPC paths and service-role behavior. Do not revoke grants blindly because it may break current routes.

## Validation results

- Local TypeScript check: passed.
- Financial `npm run test:all`: blocked at the first test because the required disposable test database variables are not configured. This is an intentional safety guard; production credentials were not used.
- Local SQL tooling (`psql`, Docker, Supabase CLI): not installed on the connected desktop, so the new migration has not been engine-tested locally.
- Supabase staging project `cleanp2p-staging`: catalog API returned no public tables; it is not currently a usable schema-matched test environment.
- Main `paxonesflows` database was queried read-only only.
- No migration was applied; no commit, push, merge, or deployment was performed.

## Next safe step

Use a disposable, schema-matched database to test the local migrations, then fix the direct-client profile access paths with a minimal-column public view and self-profile API/RPC. Apply the admin-login identity migration only after its SQL tests and login regression tests pass.

- Additional local checks completed after this review: `npx tsx tests/2fa-session-edge.test.ts` passed; `npm run lint` exited successfully with many existing warnings; `npm run build` completed successfully on Next.js 15.5.28 and generated 47 static pages.
- Current production dependency audit (read-only `npm audit --omit=dev`): 69 findings — 57 moderate, 12 high, 0 critical. This is still a release blocker; do not use `npm audit fix --force` without a planned major-version migration and regression testing.
- `git diff --check` passed; only Windows LF-to-CRLF warnings were emitted.
- The worktree currently has 141 changed/untracked paths across the existing accumulated local batch; no commit or push was made.


## 2026-10-19 follow-up: trade RPC admin-metadata hardening

- Read-only inspection of live `paxonesflows` function definitions found user-editable `auth.users.raw_user_meta_data` role checks in five RPCs: `mark_p2p_trade_paid`, `raise_trade_dispute`, `resolve_trade_dispute`, `expire_p2p_trade`, and `cancel_expired_p2p_trades`. User-editable Auth metadata must not authorize financial, dispute, or privileged trade operations. The last three are currently service-role-only, but should not rely on user metadata either.
- Added local migration `20261019130000_remove_user_metadata_admin_trust_from_trade_rpcs.sql`. It retrieves the exact currently installed function definitions with `pg_get_functiondef`, removes only the unsafe role predicate across the observed formatting variants, preserves other function logic and ACLs, and fails closed if it cannot match the expected expression. It does not revoke the authenticated RPC access needed by participant flows.
- Added static contract test `tests/trade-rpc-admin-metadata-migration.test.ts`.
- Passed: the new migration contract test, existing admin-login migration contract test, escrow search-path migration contract test, `npm run typecheck`, and `git diff --check` (only Windows LF/CRLF warnings).
- Not yet done: no isolated PostgreSQL engine test, no runtime impersonation test, no live migration. The production database remains unchanged. Before deployment, run the migration in a disposable schema and verify that forged user metadata cannot authorize either action while legitimate participant actions still work.
