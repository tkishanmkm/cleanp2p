# Production security review — 2026-10-19

## Scope and safety

- Read-only inspection of the Supabase project `paxonesflows` (`eaiwgfxoiwxepinvcykg`) and local migrations/tests in `C:\Users\theki\cleanp2p`.
- No live database writes, migrations, financial actions, commits, pushes, or deployments were performed.
- The separate project `cleanp2p-staging` currently returns no public tables and no migration history; it is not yet a usable isolated test database for the current schema.

## Confirmed live findings

1. **Admin identity RPC exposes an avoidable authorization-probing surface.** The live `public.verify_admin_login(p_user_uuid, user_uuid)` function is `SECURITY DEFINER`, executable by `authenticated`, and chooses `COALESCE(p_user_uuid, user_uuid, auth.uid())` without binding the supplied user ID to the authenticated caller. An authenticated user can ask about a different UUID and receive role/authorization information. Local migration `20261019110000_harden_verify_admin_login_identity.sql` adds the caller-ID binding for non-service callers. Static contract test passes; migration is not applied live or SQL-engine-tested.

2. **Direct client inserts into transfer history are currently permitted by policy.** Live `public.transfers` has a `Users can insert transfers as sender` policy alongside several duplicate participant-read/service-role policies. A sender-ID check alone does not make direct transfer-row writes safe because the client may forge amount/status/fee metadata. Local migration `20261018110000_restrict_public_financial_write_policies.sql` removes the client insert policy, revokes authenticated write privileges, preserves participant reads, and reserves writes for the trusted backend. Static contract test passes; not applied live.

3. **Live security advisor reports 18 `SECURITY DEFINER` functions executable by authenticated users.** This is not proof that all 18 are exploitable; each function needs a per-function authorization review. The live `initiate_trade_with_escrow` function does include account-status checks and caller-ID mismatch checks, but its exact live definition differs from the latest local migration history. Keep the prepared database-level restrictions and regression tests; do not treat advisor warnings as automatically safe or automatically exploitable.

4. **Three security-sensitive tables have RLS enabled and zero policies:** `user_2fa_pending_enrollments`, `user_2fa_recovery_codes`, and `user_security_audit_logs`. This currently fails closed for direct API access, but confirm intended access paths and whether service-role-only access is deliberate before adding any policies.

5. **Supabase performance advisor has not yet been reviewed for this snapshot.** Security advisor also reported 18 callable security-definer functions and the three no-policy tables above. The separate staging project is empty, so a proper isolated migration run still needs a schema-provisioned disposable database.

## Local validation run

Passed:

- `tests/2fa-session-edge.test.ts`
- `tests/verify-admin-login-migration.test.ts`
- `tests/financial-write-guard-migration.test.ts`
- `tests/financial-fk-indexes-migration.test.ts`
- `tests/restrict-didit-kyc-migration.test.ts`
- `tests/offline-ad-owner-resolution-migration.test.ts`
- `tests/transfer-account-status.test.ts`

These are local/static contract tests, not proof that migrations execute successfully against PostgreSQL or that runtime authorization is correct.

`npm run test:all` is **blocked**, not passed: the financial integration tests require a disposable database configured with `PAXONES_TEST_SUPABASE_URL`, `PAXONES_TEST_SUPABASE_SERVICE_ROLE_KEY`, and `PAXONES_TEST_DB_ALLOW_MUTATIONS=1`. Do not supply production credentials.

`npm audit --omit=dev --audit-level=high` exits non-zero and currently reports **69 production-tree vulnerabilities: 57 moderate and 12 high**. The output includes transitive Genkit/Google Cloud/OpenTelemetry issues and Tailwind 3 dependency issues; do not run `npm audit fix --force` without a planned framework/CSS regression migration.

## Next actions

1. Provision a disposable PostgreSQL/Supabase test database with the current schema and run all new migrations in timestamp order; add behavioral tests for admin identity mismatch, transfer direct-insert denial, KYC RPC grants, account-status blocks, offline-ad owner resolution, retention, and ad limits.
2. Prepare a reviewed deployment plan for the local migrations. Apply none to `paxonesflows` until the migration run, backup/rollback plan, and explicit production approval are complete.
3. Audit all 18 live security-definer functions individually, prioritizing trade settlement/cancellation, admin actions, KYC, and transfer/financial RPCs. Preserve legitimate service-role callers and do not remove authenticated execute rights until client call sites are migrated safely.
4. Triage the 12 high production dependency findings with a non-breaking dependency plan and regression tests.

**Status: NOT production-ready.** Live database changes are still outstanding; financial integration tests are blocked pending a disposable test database; dependency high-severity findings remain.


## Additional verified database grants and performance findings

- A read-only privilege check confirms that live `anon` and `authenticated` roles both have `SELECT`, `INSERT`, `UPDATE`, and `DELETE` table privileges on `public.transfers`. Combined with the legacy broad/PUBLIC policies and direct-insert policy, this is a high-priority defense-in-depth issue. The local financial-write migration revokes anonymous and authenticated mutation privileges and leaves read access scoped to authenticated participants; validate the history component and RPC paths before deployment.
- Performance advisor reports **5 unindexed foreign keys**, covered by the local prepared index migration `20261019100000_add_financial_fk_indexes.sql`; **38 RLS init-plan warnings** where `auth.uid()`/`auth.*` calls can be wrapped in scalar subqueries after policy-by-policy review; and **5 duplicate index pairs**. Do not drop duplicate indexes until confirming constraint ownership, dependent queries, and exact definitions.
- Performance advisor also reports multiple permissive policies, particularly on `transfers`, `user_balances`, `user_blocks`, and `trade_moderator_participations`. These require review for both overlapping policy semantics and actual SQL grants; a permissive RLS policy is not the same thing as a table privilege, but the live `transfers` role grants above are confirmed.
- Security/performance advisor references: https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy ; https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable ; https://supabase.com/docs/guides/database/database-linter?lint=0001_unindexed_foreign_keys ; https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select


## Follow-up snapshot — 2026-10-19

### Additional read-only live checks

- Confirmed the production project is `paxonesflows` (`eaiwgfxoiwxepinvcykg`). The separate `cleanp2p-staging` project has no migration history and no public tables, so it is not yet a usable isolated validation target.
- Live `public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)` is a `SECURITY DEFINER` function executable by `authenticated`, and its live definition sets `search_path TO 'public', 'pg_temp'`. It has caller-ID binding and explicit buyer/counterparty account-status checks, but the path can be hardened further. Prepared local migration `20261019120000_harden_trade_escrow_rpc_search_path.sql` changes only the function's configuration to an empty search path; a static contract test was added at `tests/trade-escrow-search-path-migration.test.ts`. Neither is deployed or engine-tested.
- Live triggers do not yet include the locally prepared chat sender/limit triggers, active-ad cap triggers, or offline-seller guard. These local protections are not active until validated and deployed.
- Confirmed schema types for prepared retention logic: `trades.id` is UUID, `trades.trade_id` is text, `trade_messages.trade_id` is text, and `trade_chat_messages.trade_id` is UUID. The retention migration uses these types in its deletion predicates.

### Follow-up validation

- Passed local static contract tests: 2FA session compatibility; admin-login identity migration; financial-write policy migration; financial FK index migration; Didit KYC RPC restriction; offline-ad owner resolution; transfer account-status guard; new escrow search-path migration.
- `npm run typecheck`: PASS.
- `git diff --check`: PASS; only Windows LF-to-CRLF working-copy warnings.
- Current `npm audit --omit=dev --audit-level=high`: **69 production-tree vulnerabilities (57 moderate, 12 high, 0 critical)**. It exits non-zero at the configured high threshold. The high findings include a transitive Genkit/OpenTelemetry chain; do not use `npm audit fix --force` as a blind fix.
- `npm run test:all`: BLOCKED by design because the financial integration tests require a dedicated disposable Supabase database and explicit mutation opt-in. No production credentials should be used. This is not a test pass.

### Current decision

No live writes, migration applications, commits, pushes, or deployments were performed. The escrow search-path hardening is prepared locally only. Before any DB deployment, provision a real isolated schema and run migrations in order; then run authorization tests and regression tests. Production readiness remains **NO** until high dependency findings, live database authorization review, full financial integration tests, and deployment/rollback planning are complete.

## Priority follow-up — trade RPC admin identity review (2026-10-19)

### Newly confirmed live function behavior

- Live `public.mark_p2p_trade_paid(uuid, uuid, text)` checks `auth.users.raw_user_meta_data->>'role' = 'admin'` and `raw_user_meta_data->>'is_admin'` as part of its admin authorization path. User metadata must not grant admin authority because it can be user-editable. This is a potential privilege-escalation path if a user can set those fields through Auth metadata updates.
- Live `public.raise_trade_dispute(uuid, uuid, text)` checks `raw_user_meta_data->>'role' = 'admin'` alongside trusted checks. That creates a similar potential unauthorized dispute/administrative path.
- The current local migration history does not exactly match these live function definitions. The local `mark_p2p_trade_paid` definition uses trusted `raw_app_meta_data` / `public.app_admins` checks; local `raise_trade_dispute` still includes the user-metadata role check in its older definition. Do not deploy an old function body wholesale without diffing all current behavior.
- Existing app call sites for these functions go through server API routes and a server-side dispute helper. A safe remediation must preserve participant authorization and all escrow/terminal-state/idempotency checks, then test direct RPC access as both an ordinary authenticated user and a legitimate admin.

### Required remediation before production

1. Reconstruct the exact live function bodies and compare them to the latest local definitions.
2. Remove `raw_user_meta_data` from every admin authorization decision in these financial/dispute RPCs. Use `public.app_admins`, trusted profile admin columns, and/or `raw_app_meta_data` only if its write permissions are controlled.
3. Add database behavior tests: an ordinary user cannot mark another user's trade paid or open an admin-only dispute by editing user metadata; a real buyer can still mark their own eligible escrow-locked trade paid; legitimate participants can still raise disputes; terminal/disputed-state guards and idempotency remain intact.
4. Validate the migration against an isolated database before considering deployment.

Status: identified from read-only live function definitions. No exploit attempt, production write, migration, or deployment was performed. The finding is not yet remediated.

## Verification update — 2026-10-19

- Re-queried live RLS policies and grants read-only. `public.ads` still has the broad `Allow public read access for ads` SELECT policy with `qual = true`; `public.transfers` still has `Users can insert transfers as sender` and live `anon`/`authenticated` table mutation privileges documented above. The local migrations that address these findings have not been applied.
- Live `paxonesflows` migration history still ends on 2026-10-16, while the newer security migrations remain local-only. The separate `cleanp2p-staging` project currently has no public tables and no migration history, so it cannot validate this migration set as-is.
- Re-checked the live SECURITY DEFINER RPC inventory. Authenticated callers can execute 18 such functions, including several admin operations and trade/KYC/2FA helpers. Internal checks differ by function; this is an audit queue, not proof each function is exploitable. Keep review per-function and do not revoke client execution blindly.
- Local `npm run typecheck`: PASS. Fourteen targeted static security/migration contract tests: PASS. `git diff --check`: PASS (only Windows LF/CRLF warnings). `npm run test:security`: BLOCKED by its safety guard because no disposable test database is configured; it did not run financial integration tests.
- Static contract tests do not prove that SQL parses/executes against PostgreSQL, that RLS behaves as expected at runtime, or that wallet/escrow balances reconcile.

### Current next action

Provision a genuinely disposable, schema-matched PostgreSQL/Supabase database without production credentials, then replay migrations in order and run behavioral tests. Until that exists, keep all new migrations local-only. Prioritize validating the broad ads read-policy removal, transfer write revocation, trade RPC admin-metadata hardening, and account-status/idempotency guards before considering deployment.
