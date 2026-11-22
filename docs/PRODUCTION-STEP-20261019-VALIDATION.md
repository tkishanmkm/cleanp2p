# Production-readiness step — 2026-10-19

## Completed checks
- Read-only inspection of live Supabase project `paxonesflows`; no database writes or financial actions.
- Live migration history currently ends at `20261016013425`. Eleven local migrations dated 2026-10-17 through 2026-10-19 are not recorded as applied.
- Live `verify_admin_login` remains callable by `authenticated` and still accepts supplied UUID arguments; local identity-binding migration is not live.
- Live `initiate_trade_with_escrow` currently uses `search_path=public, pg_temp`; local empty-search-path hardening is not live.
- Live trade RPCs `mark_p2p_trade_paid`, `raise_trade_dispute`, `resolve_trade_dispute`, `expire_p2p_trade`, and `cancel_expired_p2p_trades` still reference `raw_user_meta_data`. Local removal of user-editable metadata from admin authorization is not live.
- Supabase security advisor: 18 SECURITY DEFINER functions executable by `authenticated`; three 2FA/security tables have RLS enabled with no policies (currently fail-closed; intended access must be confirmed).
- Supabase performance advisor: 5 unindexed foreign keys, 38 auth RLS init-plan warnings, 5 duplicate-index pairs, and multiple permissive-policy warnings. No automatic policy rewrites or index drops were performed.
- Local static migration contract tests passed for FK indexes, financial-write guard, Didit KYC RPC restrictions, escrow search_path hardening, trade RPC user-metadata hardening, admin-login identity hardening, and offline-ad owner resolution.
- `npm run typecheck` passed. `git diff --check` passed with Windows LF/CRLF warnings only.

## Blockers
- `psql`, Docker, and Supabase CLI are not installed on the connected desktop.
- Disposable database test variables are not configured; mutation-enabled financial tests must not use production credentials.
- Prepared migrations have not been engine-tested or applied. No commit, push, merge, or deployment was performed.
- Latest documented production dependency audit remains 69 findings: 57 moderate, 12 high, 0 critical.

## Next action
Provision or connect a disposable, schema-matched PostgreSQL/Supabase database. Apply and test pending migrations there in order, then run financial authorization and regression tests. Keep migrations local until this gate and an explicit deployment approval are complete.

## Follow-up hardening check — 2026-10-19

- Rechecked the live trade escrow RPC read-only: it is SECURITY DEFINER, callable by authenticated users, and currently uses `search_path=public, pg_temp`. It has caller-ID and account-status checks; prepared migration `20261019120000_harden_trade_escrow_rpc_search_path.sql` is local only.
- Reviewed the local trade-RPC admin-metadata migration and added a fail-closed postcondition: if any `raw_user_meta_data` reference remains in any of the five targeted RPC definitions after the safe rewrite, the migration aborts rather than installing a partially hardened function.
- Updated `tests/trade-rpc-admin-metadata-migration.test.ts` to assert that postcondition.
- Static contract tests passed for trade-RPC metadata hardening, admin-login identity hardening, and escrow search-path hardening.
- Typecheck was started; final exit status still needs independent confirmation. PostgreSQL execution/behavior tests remain blocked because the staging project is empty and no local PostgreSQL/Docker/Supabase CLI is installed.
- No live writes, migration applications, commits, pushes, merges, or deployments were performed.

**Status: NOT PRODUCTION READY.**


## Follow-up validation — 2026-10-19 (next step)

- Confirmed project IDs read-only: `paxonesflows` (production) and `cleanp2p-staging` (staging).
- Confirmed staging is currently empty: zero public base tables, zero public routines, and no recorded migrations. It cannot validate these changes until a schema-matched test database is prepared.
- Rechecked production Supabase security advisor: 18 `SECURITY DEFINER` functions remain executable by `authenticated`; this is a review queue, not proof each function is exploitable. Three 2FA/security tables have RLS enabled without policies (fail-closed behavior; intended access needs review).
- Current production-only `npm audit` reports 69 findings: 57 moderate, 12 high, 0 critical. The high findings are largely in the Genkit / Google Cloud / OpenTelemetry dependency chain; no safe automatic fix was reported. Do not force-upgrade without compatibility tests.
- `npm run typecheck`: PASS, exit code 0.
- `npx tsx tests/2fa-session-edge.test.ts`: PASS.
- `npx tsx tests/transfer-account-status.test.ts`: PASS.
- Ten static migration-contract tests passed, including admin-login identity binding, escrow RPC search_path, user-metadata admin authorization removal, disabled-account idempotency replay, participant account-status guard, financial write policy guard, FK indexes, Didit KYC RPC restrictions, offline-ad owner resolution, and trade-chat guards.
- `npm run test:all`: BLOCKED at the first financial integration test by the intentional guard requiring `PAXONES_TEST_SUPABASE_URL`, `PAXONES_TEST_SUPABASE_SERVICE_ROLE_KEY`, and `PAXONES_TEST_DB_ALLOW_MUTATIONS=1`. No production credentials were used.
- Static tests do not prove SQL syntax/runtime correctness, RLS behavior, transaction atomicity, or financial correctness. No live migrations or database writes were performed.

### Current release gate

**NOT PRODUCTION READY.** The immediate blocker is a disposable schema-matched PostgreSQL/Supabase test environment, followed by executing migrations in order and running participant/admin impersonation tests. After that, review the production `SECURITY DEFINER` inventory and resolve the public-vs-self profile read model without granting broad access to sensitive `profiles` columns. Production dependency findings and real financial end-to-end tests remain release blockers.

## 2026-10-19 — Live database security validation (read-only)

- Confirmed the configured active app database is the `paxonesflows` Supabase project (`eaiwgfxoiwxepinvcykg`), PostgreSQL 17.6. The separate `cleanp2p-staging` project currently reports no registered migrations and no public tables; it is not a usable isolated test database in its present state.
- Live read-only inspection: 84 migrations are recorded on `paxonesflows`. No SQL was applied and no financial data was mutated.
- Live Supabase Security Advisor findings: 18 `SECURITY DEFINER` functions are executable by `authenticated`; each needs an explicit intended-caller review (the lint is not by itself proof of exploitability). Three 2FA/security audit tables have RLS enabled and no policies, but direct table grants are limited to `postgres`, `service_role`, and `supabase_auth_admin`, with no `authenticated` or `anon` table grant observed.
- Confirmed the live `public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)` currently has `search_path=public, pg_temp` and does not yet contain the new `TRADE_INITIATION_ACCOUNT_DISABLED` guard. Local prepared migrations `20261019120000_harden_trade_escrow_rpc_search_path.sql` and `20261019140000_block_disabled_account_idempotency_replay.sql` address these two gaps, but are NOT deployed. The trigger migration `20261019080000_guard_trade_participant_account_status.sql` is also local-only.
- Local static migration contract tests passed for financial FK indexes, financial write guards, trade participant account status, escrow RPC search path, trade RPC user-metadata admin trust, disabled-account idempotency replay, SECURITY DEFINER search-path hardening, offline-ad owner resolution, and trade-chat guards.
- `npx tsx tests/2fa-session-edge.test.ts`: PASS. `npx tsx tests/transfer-account-status.test.ts`: PASS. `npm run typecheck`: PASS. `npm run lint`: PASS with existing warnings. `git diff --check`: PASS (Windows line-ending warnings only).
- `npm run test:all` and `tests/security-verification.test.ts` are intentionally blocked because no disposable test database is configured (`PAXONES_TEST_SUPABASE_URL`, `PAXONES_TEST_SUPABASE_SERVICE_ROLE_KEY`, `PAXONES_TEST_DB_ALLOW_MUTATIONS=1` are absent). Do not point these destructive integration tests at production.
- Latest `npm audit --omit=dev --audit-level=high`: 69 production dependency advisories (57 moderate, 12 high, 0 critical in this run). Many are transitive Genkit/OpenTelemetry dependencies with no direct safe fix; `node-cron` and Tailwind-related advisories suggest major upgrades. No forced upgrades were performed.
- No push, commit, live migration, deployment, chain transaction, or wallet mutation occurred.

### Gate status

Still **NOT production-ready**. Required next gates: provision/verify a disposable PostgreSQL 17 test database; execute all local migrations and adversarial integration tests there; review and reduce live Supabase advisor findings; resolve production dependency advisories using a tested upgrade plan; then rerun build, lint, typecheck, integration tests, and a passive security scan.
- Fresh `npm run build`: PASS on Next.js 15.5.28; optimized compile, type validation, 47/47 static pages, route optimization, and trace collection completed with exit code 0. Build still emits existing ESLint warnings (object-injection heuristics, unsafe-regex warnings, missing hook dependencies, and `<img>` optimization warnings).


## 2026-10-19 - Trade-chat migration schema compatibility follow-up

- Read-only live catalog inspection confirmed the production `trades` schema uses text `buyer_id` / `seller_id`, has `id` UUID and `trade_id` text, and does not have `firestore_trade_id`. The chat migration had referenced the absent column and compared text participant IDs to a UUID variable; these would have caused the participant guard to fail at runtime.
- Corrected the local-only `20261017170500_trade_chat_message_limits_and_retention.sql` to remove the nonexistent column references and compare participant IDs as text.
- Hardened the 100-message cap to count both `trade_messages` and `trade_chat_messages`, sharing the advisory lock across both trigger paths so table switching cannot trivially bypass the cap. This counts stored rows across both tables; if the application mirrors a single logical message into both tables, that duplication policy must be resolved before production use.
- Updated `tests/trade-chat-guards-migration.test.ts` to guard against regressions to the live schema mismatch.
- Validation: trade-chat static contract test PASS; 10 additional migration-contract tests PASS; `npm run typecheck` PASS; `git diff --check` PASS (only Windows LF/CRLF warnings).
- Read-only catalog inspection also confirmed `pg_cron` is installed and the expected `ads`, `p2p_ads`, `notifications`, `trade_messages`, and `trade_chat_messages` tables/columns exist in production. This is schema evidence only, not migration execution evidence.
- `psql`, Docker, and Supabase CLI remain unavailable locally. No migration was applied to production; no commit, push, merge, deployment, or financial action was performed. The local SQL still requires execution and adversarial authorization tests against a disposable, schema-matched PostgreSQL/Supabase database.

**Status remains NOT PRODUCTION READY.**


## 2026-10-19 — Continued local validation and profile-access blocker

- Re-ran `tests/trade-chat-guards-migration.test.ts`: PASS.
- Re-ran `tests/trade-escrow-search-path-migration.test.ts`: PASS.
- Re-ran `tests/trade-rpc-admin-metadata-migration.test.ts`: PASS.
- Re-ran `tests/verify-admin-login-migration.test.ts`: PASS.
- Re-ran `npm run typecheck`: PASS, exit code 0.
- Read-only source inventory confirms many direct `profiles` table reads remain across public pages, profile/settings, trade/ad flows, wallet components, and admin pages. The live database currently denies `SELECT` table privilege to `anon` and `authenticated`, despite a public-read RLS policy; a policy alone does not grant table privileges. Do not solve this by granting broad SELECT on `profiles`, which contains sensitive fields. The next code batch must classify each callsite and migrate public-card reads to a narrow public projection and self-profile reads to a protected server/API path, with admin/service-role paths kept separate.
- No production SQL, profile grants, or RLS policies were changed. No commit, push, merge, deployment, or financial operation was performed.
- Static migration tests are source-contract checks only; SQL engine execution and auth/participant impersonation tests remain blocked by the absence of a schema-matched disposable PostgreSQL/Supabase test database.

**Gate remains NOT PRODUCTION READY.**


## Follow-up validation pass — 2026-10-19

### Passed
- Nine focused migration-contract tests passed: active-ad limit, offline-ad owner resolution, public-ad read policy, SECURITY DEFINER search paths, trade-chat guards, escrow RPC search path, disabled-account idempotency replay, trade participant account status, and removal of user-metadata admin trust.
- `npm run typecheck` completed without TypeScript errors.
- `git diff --check` passed; Git only emitted expected Windows LF-to-CRLF normalization warnings.
- Current production dependency audit snapshot: 69 findings (57 moderate, 12 high, 0 critical). This is still a release blocker and needs dependency-by-dependency remediation with regression testing.

### Live database / staging observations (read-only)
- `paxonesflows` is active and its recorded migration history currently ends at `20261016013425`; the newer local migrations dated 2026-10-17 through 2026-10-19 are not recorded as applied.
- `cleanp2p-staging` is active but has no recorded migrations and its security/performance advisor returned no lints because it has no schema to validate. It is not a schema-matched staging environment.
- Production security advisor continues to report 18 SECURITY DEFINER functions executable by `authenticated`; these must be individually reviewed for intended exposure and internal authorization, not blindly revoked.
- Production performance advisor continues to report missing FK indexes and duplicate indexes; verify index definitions and workload before changing anything.
- The repository inventory found many direct `profiles` reads in both server and client code. The previous read-only catalog check found no SELECT table privilege for `anon` or `authenticated` despite a permissive public-profile RLS policy. Do not solve this by granting SELECT on the entire `profiles` row. Next action is to classify direct-client reads by required fields and route them through self-only APIs/RPCs or a minimal-column public profile surface, then run page-level regression tests.

### Not done / release blockers
- No live database write or migration was applied; no commit, push, merge, or deployment occurred.
- SQL has not been executed against a disposable, schema-matched PostgreSQL instance. `psql`, Docker, and Supabase CLI are unavailable on the connected desktop.
- Full financial runtime tests remain blocked until a separate disposable test database is configured. Never use production credentials for mutating test suites.
- Production dependency vulnerabilities, profile access compatibility, full financial/chain integration tests, and ZAP scanning remain unresolved.

**Status: NOT PRODUCTION READY.**
