# Production Step — Live Database Privilege Validation (2026-10-19)

## Scope and safety

Read-only inspection of the connected Supabase project `paxonesflows` (`eaiwgfxoiwxepinvcykg`). No SQL changes, migrations, grants, data mutations, commits, pushes, or deployments were performed. The separate project `cleanp2p-staging` (`tazvjyrdondcrdrkggqe`) returned no migration history and no public tables, so it is not currently a usable schema-matched validation target.

## Verified findings

1. **KYC session RPC grant is broader than the local hardening plan.** Live `public.initiate_didit_kyc(uuid,text)` is `SECURITY DEFINER`, has `search_path=public, pg_temp`, and `EXECUTE` is granted to `authenticated`. The local pending migration `20261018100000_restrict_didit_kyc_rpc_execution.sql` revokes `PUBLIC`, `anon`, and `authenticated` and grants only trusted backend roles. The live migration history inspected does not include this local migration. Treat as high priority because the RPC accepts a user ID and third-party session ID.

2. **Admin-login identity probe remains possible through the live RPC contract.** Live `public.verify_admin_login(uuid,uuid)` is `SECURITY DEFINER`, is executable by `authenticated`, and the installed body chooses the supplied UUID before `auth.uid()`. It can return the target account's admin/role result to a signed-in caller. The local pending migration `20261019110000_harden_verify_admin_login_identity.sql` binds authenticated requests to `auth.uid()` and permits explicit target lookup only for `service_role`.

3. **Financial trade RPCs still trust editable user metadata for admin checks.** The inspected live bodies for `mark_p2p_trade_paid` and `raise_trade_dispute` contain checks against `auth.users.raw_user_meta_data->>'role'` and/or `raw_user_meta_data->>'is_admin'`. User-editable metadata must not authorize administrative actions. Local pending migration `20261019130000_remove_user_metadata_admin_trust_from_trade_rpcs.sql` removes this authorization source from five reviewed trade RPCs and fails closed if it cannot identify the expected predicates.

4. **Several `SECURITY DEFINER` functions still have ambient `search_path`.** The live function configurations include `public, pg_temp` for `cancel_p2p_trade`, `initiate_trade_with_escrow`, `mark_p2p_trade_paid`, and `raise_trade_dispute`; KYC and other functions also use `public` in their path. Local migrations `20261019120000_harden_trade_escrow_rpc_search_path.sql` and `20261019150000_harden_security_definer_search_paths.sql` prepare path hardening. These are not live-applied according to the inspected migration history.

5. **Supabase security advisor warnings confirmed exposure surface.** The advisor reports 18 `SECURITY DEFINER` functions executable by `authenticated` and three RLS-enabled tables with no policies (`user_2fa_pending_enrollments`, `user_2fa_recovery_codes`, `user_security_audit_logs`). No policy change was made: these may intentionally be service-only, and table privileges must be checked alongside policies before deciding remediation.

## Validation performed

- Static contract tests for trade chat guards, offline-ad owner resolution, participant account-status checks, SECURITY DEFINER search paths, escrow search path, metadata-admin trust removal, disabled-account idempotency replay, financial write guards, Didit KYC RPC restriction, admin-login identity, and financial FK indexes: **all passed**.
- These are source-level/static contract tests, not PostgreSQL execution or live authorization tests.
- The project `cleanp2p-staging` currently has no migration history or public tables; it cannot validate these migrations without first being provisioned as an isolated schema-matched environment.

## Release decision

**Do not call the app production-ready.** The fixes are prepared locally but have not been applied to the connected database. Before any deployment, validate each migration against a disposable schema matching the live function signatures and dependent objects, run negative/positive authorization tests, review grants and advisor results, and obtain explicit approval before applying changes to the live database. Never blindly revoke every authenticated `SECURITY DEFINER` grant; some functions are intentionally client-callable and rely on internal authorization checks.


## Additional read-only review and prepared fix - 2026-10-19

- Live `public.ads` has the policy `Allow public read access for ads` with `USING (true)`. This is broader than the active/non-deleted visibility rule on `public.p2p_ads`, and means the policy itself does not hide paused, draft, or soft-deleted canonical ads.
- Local migration `20261019160000_restrict_public_ad_reads.sql` replaces that broad policy with public access only for active and non-deleted ads, and adds a separate authenticated-owner policy so owners can still read their own paused/draft ads while not deleted.
- Added `tests/public-ad-read-policy-migration.test.ts`; it passes as a static SQL-contract test. `git diff --check` passed; only existing Windows LF/CRLF normalization warnings appeared.
- Confirmed this workstation currently has no `psql`, `postgres`, `docker`, or Supabase CLI executable, and the separate staging Supabase project has no tables or migration history. Therefore this SQL has **not** been executed against PostgreSQL, and must not be deployed until isolated-schema validation and admin-dashboard regression checks are completed.
- Additional privilege review: the three RLS-enabled 2FA/security tables flagged by the advisor have no policies, but `anon` and `authenticated` also lack direct table privileges; this is not currently evidence of direct table access. Do not add broad policies to silence the advisor.
- Live `initiate_trade_with_escrow`, `verify_admin_login`, and `initiate_didit_kyc` still have broader runtime exposure/search-path configuration than the local pending hardening migrations address. The current local security tests pass, but the live database remains unchanged.

## Current decision

**NOT PRODUCTION READY.** The canonical-ad visibility fix is prepared locally only. No live database changes, commits, pushes, merges, deployments, or financial operations were performed.
