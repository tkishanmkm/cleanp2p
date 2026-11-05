# Paxones audit step — locale selector and live advisor refresh (2026-11-01)

## Status
Local-only audit/fix. No tests, build, typecheck, smoke test, database writes, migration, commit, push, or deployment were performed in this step.

## Fix made
`src/app/settings/page.tsx` had a private language list that offered unsupported codes (`de`, `zh`, and `pt`) which do not exist in the app-wide translation registry. Saving one could persist a language that the global i18n provider could not load, causing the app to fall back to English. Settings now imports the shared `LANGUAGES` registry from `src/lib/constants.ts`, so the settings dropdown only offers locale codes that the app-wide provider actually supports.

## Locale coverage audit (read-only)
Compared every flattened locale key with `src/locales/en.json`:

- `ar`, `en`, `es`, `fr`, `hi`, `ko`, `pt-BR`, `ru`, `vi`, `zh-CN`, and `zh-TW` each contain all 1,387 English keys with no missing or extra keys.
- `bho.json` and `en-IN.json` each contain only 74 of the 1,387 keys. They are not registered in the app-wide i18n provider or supported language picker, so they are not active selectable locales. If they are intended to become active later, they need complete coverage and explicit registration before exposure.
- Key parity is not proof of translation quality. Terms and Privacy clauses remain English with a disclosure that they have not received professionally reviewed full translations. This remains a launch limitation for any jurisdiction where localized legal text is required.
- The app-wide registry currently supports 11 locales; the settings-only `de`, `zh`, and `pt` choices were removed by using that shared registry.

## Fresh live Supabase advisor snapshot
Production project `paxonesflows` (`eaiwgfxoiwxepinvcykg`), read-only advisor results observed at 2026-11-01 around 02:58 UTC:

### Security
- 3 INFO: RLS enabled with no policies on `user_2fa_pending_enrollments`, `user_2fa_recovery_codes`, and `user_security_audit_logs`. Earlier ACL review indicated these are intended service-only tables; do not add broad user policies merely to silence the linter.
- 18 WARN: authenticated callers can execute selected `SECURITY DEFINER` functions. These require per-function call-site, grant, identity, role-check, and body review; do not bulk-revoke because some are intended authenticated RPCs.
- Earlier source/catalog review found unsafe reliance on user-editable `raw_user_meta_data` for administrator checks in live trade RPCs and an admin ledger policy. Local migration candidates exist but remain unapplied and need isolated SQL validation.

### Performance
- 5 missing foreign-key indexes: `deposits(user_id)`, `platform_ledger_entries(related_user_id)`, `profiles(emergency_frozen_by)`, `sweep_queue(user_id)`, `utxo_reservations(sweep_id)`.
- 38 policies flagged for per-row auth function evaluation.
- 74 multiple-permissive-policy warnings. This is a newly recorded count; each policy must be reviewed for actual overlapping access, role scope, and policy semantics before cleanup.
- 5 duplicate-index warnings: pairs on `admin_main_wallets`, `feedback`, `profiles`, `transfers`, and `wallets`. Do not drop indexes without checking constraints, dependencies, query plans, and write paths.
- 49 unused-index INFO findings. Do not bulk-drop; the production usage window and workload may be incomplete, and indexes can protect critical low-frequency financial/admin paths.

The staging project `cleanp2p-staging` (`tazvjyrdondcrdrkggqe`) returned no advisor lints but has no application tables, so it is not a schema-faithful validation environment and its clean advisor report is not evidence of production readiness.

## Secret-pattern scan
A heuristic repository scan excluding `.env*`, dependencies, generated output, lockfiles, maps, and docs found two files with pattern matches. Inspection showed these are test/preflight code references to environment variable names and placeholder guards, not embedded production credentials. `.env.example` is tracked and contains blank placeholders only. This heuristic is not a substitute for a complete secret-history scan or rotation review.

## Critical release blockers unchanged
- Production has 81 migrations recorded while the local chain has 182 SQL files; provenance must be reconciled before applying the local chain.
- Production withdrawals remain incompatible with the current local request/worker/settlement contracts (idempotency RPC/table missing, legacy unfenced claim RPC, required-column/ledger schema mismatch). Do not enable withdrawals or patch production with isolated columns.
- Production Didit webhook failure-path/idempotency and atomic persistence still need schema-backed remediation and validation.
- No schema-faithful disposable PostgreSQL environment is available. Staging has no application schema.
- Tests and build checks remain intentionally deferred until the user-requested audit/fix phase is complete.

**Overall status: NOT PRODUCTION READY — DO NOT LAUNCH.**

## Additional code hardening in this step

- `src/app/api/webhooks/didit/route.ts` no longer reads the entire request body without a bound. It now streams the body, stops and cancels reading above 2 MiB, and returns HTTP 413 before JSON parsing or database work. This limits memory-exhaustion exposure from oversized unauthenticated webhook requests while preserving the existing signature validation flow for bounded payloads.
- This change is local and uncommitted. It has not been typechecked or exercised because tests/build checks are intentionally deferred until the audit/fix phase is complete. The configured Didit provider's real maximum legitimate payload size must be confirmed before deployment.

## Dependency advisory remediation

- The production-dependency audit initially found one HIGH advisory in transitive `follow-redirects@1.16.1` under `axios@1.20.0`.
- Ran `npm audit fix --omit=dev --ignore-scripts`: npm reported 264 packages removed from the installed tree (dev dependencies omitted), 1 package changed, and **0 vulnerabilities in the production dependency set**.
- A full all-dependency `npm audit` was started separately but had not returned a result at the time this note was written. Therefore the complete development/build-tool dependency advisory state remains unverified. The removal of dev packages from `node_modules` is an expected consequence of `--omit=dev`; reinstall the full dependency tree before later build/test verification.

## Additional TOTP-at-rest hardening (local source only)

- Tightened user and administrator TOTP ciphertext validation to require the complete versioned AES-256-GCM layout: 12-byte IV, 16-byte authentication tag, and non-empty hex ciphertext. Malformed ciphertext-looking values are no longer treated as legacy plaintext; legacy plaintext is accepted only when it matches a bounded Base32 pattern so it can be migrated.
- Added conditional compare-and-set migration helpers for both user and admin TOTP profile columns. They encrypt legacy secrets with the dedicated server-side keys, update only when the exact prior values still match, and re-read/validate current ciphertext if a concurrent rotation wins. These migrations do not change `profiles.updated_at`, preserving existing user 2FA session-version semantics.
- Wired the user helper into the shared money-movement/escrow 2FA guard, login challenge, 2FA disable, 2FA rotation proof, normal verify challenge, and security-question update verification. Wired the administrator helper into shared admin sensitive-action checks, login challenge, 2FA disable, support emergency activation, and `getAdminSecurityState`.
- This is source-level hardening only. Production does not currently contain the corresponding atomic user/admin 2FA RPCs or persistent rate-limit tables (`enable_user_2fa_atomic`, `disable_user_2fa_atomic`, `consume_user_2fa_recovery_code_with_audit`, admin 2FA atomic lifecycle RPCs, `user_2fa_rate_limits`, `admin_2fa_rate_limits`). The relevant new migration files are local candidates and must be schema-validated and applied in correct migration order before deployment. Existing routes that depend on those RPCs fail closed when the RPC is missing; do not deploy them independently of their database changes.

## Verification constraints recorded this step

- `git diff --check` completed with exit code 0. Git emitted line-ending (LF-to-CRLF) advisory messages for existing modified files; these are line-ending notices, not reported whitespace errors.
- A syntax-parser-only pass was attempted for the touched TypeScript files, but the local `typescript` module is absent from `node_modules` after the prior `npm audit fix --omit=dev` and failed `npm ci` attempt. No parser result was obtained.
- `npm ci` remains blocked by `EPERM` when Windows attempts to unlink the Sharp native `libvips-42.dll` currently held by the local Next.js server process. No process was stopped and no files were reset.
- No build, typecheck, lint, automated test, smoke test, production DDL, migration deployment, commit, push, or application deployment was performed in this step.

## Role-separated TOTP migration correction

- A further review found that `profiles.two_factor_secret` is a legacy shared fallback while user and admin TOTP ciphertexts use different server keys. Mirroring user-key ciphertext into that shared column could make admin verification fail (and vice versa).
- User migration now writes the canonical `totp_secret` column and only mirrors the legacy `two_factor_secret` for non-admin profiles. For an admin/support-admin profile it leaves the legacy column untouched until the administrator migration can split it.
- Admin migration now reads the legacy shared secret, authenticates it using the admin key or (for older shared values) the user key, and atomically moves it into role-specific `admin_2fa_secret` and `totp_secret` columns when the corresponding role flags are active. It clears `two_factor_secret` in the same conditional update once the required role-specific encrypted values are available. It does not update `profiles.updated_at`.
- The shared financial-action 2FA guard and user login challenge run the role-separation migration for admin profiles after encrypting the user secret, so the old shared plaintext fallback is not intentionally left behind after those protected actions succeed. All operations fail closed if either ciphertext cannot be authenticated or the CAS update loses a conflicting race.
- This migration path still requires a successful server-side `USER_2FA_ENCRYPTION_KEY` and `ADMIN_2FA_ENCRYPTION_KEY`; key inventory, production secret presence/rotation, and a schema-backed test of the compare-and-set migration have not been verified.

## Fresh complete dependency audit

- `npm audit --omit=dev --json`: **0 production dependency vulnerabilities** (373 prod dependency nodes; 726 total nodes in the lockfile audit inventory).
- `npm audit --json`: **18 MODERATE, 0 HIGH, 0 CRITICAL** in the full tree. The findings are confined to development/lint tooling and cascade from `minimatch` versions below 11.0.1, including ESLint 8's minimatch 3 dependency and the current TypeScript-ESLint parser's minimatch 10 dependency.
- The advisory was published/updated on 2026-10-30 and lists `minimatch` 11.0.1 as the patched version. A blind global override is not safe: minimatch 9 removed the default export, while this repo's ESLint 8 dependency expects the older callable API; changing the lint toolchain/config/Next major in one unverified edit could break lint or build. Keep this as a tooling upgrade blocker and resolve it in a separate validated ESLint/Next config migration rather than disguising it with an incompatible override.
## Continued audit update — 2026-11-01, afternoon

### Full dependency audit
- Added the exact patched minimatch version 11.0.1 as a package-manager override, then updated package-lock.json with npm install --package-lock-only --ignore-scripts --no-audit --no-fund.
- Re-ran the complete npm audit --json on the updated lockfile.
- Result: **0 info, 0 low, 0 moderate, 0 high, 0 critical; 0 total vulnerabilities** across the full dependency graph (373 production, 287 development, 90 optional, 1 peer).
- The previous 18 moderate advisories all flowed through ESLint/minimatch. No forced major upgrade of ESLint/Next tooling was performed.

### Additional production authorization finding and local candidate fix
- Read the live definitions and confirmed exactly one unsafe raw_user_meta_data ->> 'role' = 'admin' fallback in each of public.mark_p2p_trade_paid(uuid,uuid,text) and public.raise_trade_dispute(uuid,uuid,text).
- The local migration 20261102000001_remove_raw_user_metadata_admin_trade_bypass.sql now performs guarded definition rewrites that remove only those exact user-editable metadata predicates, retaining participant checks and trusted admin checks. It also adds a caller/subject binding guard to verify_admin_login(uuid,uuid) so authenticated users cannot query another user's administrative status. Service-role server verification remains supported.
- The 18 SECURITY DEFINER functions were reviewed by category. get_user_2fa_status already permits a caller to query another user's setting only when service-role or public.is_admin() is true; initiate_didit_kyc binds p_user_id to auth.uid() (or service-role); bulk admin RPCs derive authenticated administrator identity from the signed-in profile and ignore caller-supplied email for attribution. These checks do not eliminate the advisor warnings, because the advisor flags authenticated EXECUTE grants irrespective of body authorization.

### Migration-history reconciliation evidence
- Production list_migrations currently returns 81 version records.
- Local supabase/migrations contains 194 SQL files with 194 unique version prefixes.
- Only one version is common between the two sets: 20261011152650.
- 80 production history entries are absent from the current local directory, and 193 local migration files do not appear in production's recorded history.
- A linked Supabase CLI history read could not connect because the remote network path does not support IPv6; it reported an IPv4 connection requirement. The Supabase MCP migration listing above is the available authoritative history snapshot.
- This is a severe migration-provenance divergence, not a condition to fix by blindly running db push, marking all files applied, or replaying the local folder in production. A schema snapshot/diff and controlled baseline reconciliation is required first.

### Advisor migration order and exact duplicates
- The live catalog has exactly two byte-for-byte duplicate policy pairs at the time queried: transfers (two authenticated SELECT policies) and wallet_assets (two service-role ALL policies). The local 20261101140000_remove_exact_duplicate_permissive_policies.sql contains guarded checks for those exact pairs.
- The five live duplicate indexes are true exact duplicates. The earlier 20261031120000_remediate_live_database_advisors.sql keeps the original constraint-backed canonical unique index and drops only the duplicate constraint/index: admin_main_wallets.currency, profiles.wallet_index, wallets.address, feedback.trade_id, and transfers(sender_id,idempotency_key). No application code references the redundant index names; the surviving indexes preserve uniqueness.
- The earlier 20261031120000 migration also performs the one-time RLS auth-function initPlan optimization. I removed a duplicated second optimizer loop from 20261101120000_fix_database_advisor_findings.sql to avoid double-wrapping already optimized expressions.
- The 20261101150000_remove_redundant_permissive_policies.sql candidate was adjusted not to preflight/drop three policies that the earlier migration already removes, and its role checks for the disputes and user-blocks superset policies now expect authenticated after the earlier migration's TO authenticated transition. System-settings and transfer checks preserve their live role scopes.
- The advisor migrations remain local candidates. They have not been applied to production or replayed on a schema-faithful isolated database.

### Remaining blockers / no release approval
- Production history vs local migration version mismatch described above.
- Withdrawal reservation/worker/settlement/ledger contract mismatch: withdrawals remain explicitly disabled; do not set ENABLE_WITHDRAWALS=true.
- Didit atomic state migration remains unapplied and must be validated with the provider payload contract.
- 18 SECURITY DEFINER warnings remain until each endpoint is either moved behind a server-only RPC boundary or justified and recorded as intentional. Do not revoke all authenticated EXECUTE grants indiscriminately.
- The 74 multiple-permissive-policy advisor findings and remaining unused-index INFO findings still require full role/action/predicate review. Exact duplicate pairs are only a subset of all permissive-policy warnings.
- Full localization, professional translations of all Terms/Privacy clauses, full source plus Git-history/deployment secret review, and server-side key-management validation remain open.
- No build, typecheck, automated tests, SQL replay, smoke test, end-to-end test, production migration, commit, push, or deploy has been performed. These remain intentionally deferred until the audit/fix phase is completed.

**Current status: NOT COMPLETE — NOT LAUNCH-READY.**

## Production RPC presence audit — current source versus live database

Read-only inventory extracted all statically named Supabase RPC calls from the local src tree and compared function names against pg_proc in production.

The live database is missing **37 RPC names called by the current local source**. This is a direct code/database contract mismatch and blocks production use of the corresponding features:

- Admin/server-only wrappers: admin_freeze_user_authorized, admin_unfreeze_user_authorized, admin_set_emergency_mode_authorized, admin_mark_trade_paid_authorized, admin_reject_withdrawal, admin_resolve_trade_dispute_atomic, admin_adjust_balance_atomic, activate_support_admin_emergency, configure_support_admin.
- Deposit pipeline: allocate_deposit_address_nonce, register_pending_deposit, claim_pending_deposit_confirmations, release_pending_deposit_confirmation_claim, process_deposit_atomic_with_lease.
- Didit webhook durability: claim_didit_webhook_event, finish_didit_webhook_event, apply_didit_webhook_state.
- 2FA lifecycle/recovery/rate limits: check_admin_2fa_rate_limit, reset_admin_2fa_rate_limit, check_user_2fa_rate_limit, reset_user_2fa_rate_limit, enable_user_2fa_atomic, disable_user_2fa_atomic, enable_admin_2fa_atomic, disable_admin_2fa_atomic, recover_admin_2fa_atomic, rotate_admin_2fa_recovery_atomic, consume_user_2fa_recovery_code_with_audit.
- Withdrawal settlement plumbing (feature remains disabled): acquire_withdrawal_worker_lease, release_withdrawal_worker_lease, renew_withdrawal_worker_lease, lookup_withdrawal_idempotency_replay, request_withdrawal_idempotent, record_withdrawal_broadcast, record_ambiguous_withdrawal_broadcast.
- Sweeper and ad status helpers: check_gas_funding_eligibility, persist_signed_gas_funding, record_ad_offline_open_attempt.

The expected local migration definitions were found for these names (some are defined by multiple historical candidates). That does not mean the SQL is deployable as a set: migration history is divergent, dependencies and actual object contracts must be validated, and the feature-specific migrations must be applied in dependency order. The exact local migrations mapping is in the repository under supabase/migrations.

### Read-only compatibility checks
- Production contains deposits, onchain_deposits, user_deposit_addresses, deposit_addresses, wallets, and the 2FA enrollment/recovery/audit tables.
- The production columns inspected for deposits, onchain_deposits, user_deposit_addresses, deposit_addresses, wallets, profiles, admin_audit_logs, disputes, trades, user_wallets, and 2FA tables include the columns consumed by the current pending-deposit registration / 2FA functions.
- This schema presence check is not a functional verification. In particular, it does not prove the corresponding RPC bodies, triggers, grants, constraints, uniqueness rules, or concurrent worker behavior are correct.
- The pending-deposit registration function does not itself credit balances; it creates/reuses pending deposit rows after resolving one unique address owner. The corresponding lease/credit pipeline is also missing in production, so enabling only registration would create pending deposits that cannot be safely settled. Do not enable deposit ingress until both registration and the fenced confirmation/credit pipeline have been deployed and verified together.
- Admin dispute settlement and admin balance adjustment have local atomic wrappers, but those RPCs are absent from production. Their local SQL uses existing trade/dispute/audit/wallet structures, but exact function and trigger behavior remains unverified against an isolated clone.
- 2FA tables/columns are present, but the atomic lifecycle and rate-limit RPCs called by current API routes are missing. Current UI/API operations that depend on them cannot be considered working on this production schema.

**Operational consequence:** do not deploy the current local application revision against this production database until the missing RPC set has been installed through a reconciled, reviewed migration release. Do not substitute direct REST writes for the missing atomic finance/security RPCs.
