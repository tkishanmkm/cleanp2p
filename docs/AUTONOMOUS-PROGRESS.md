# Paxones Autonomous Production-Readiness Progress

## Current audit batch — 2026-11-28 (withdrawal failures, browser setup, and next wallet checks)

- Verified checkout `tkishanmkm/cleanp2p`, branch `main`, at `c9e113613cef622bd3224da6596eb7fe3c7b71ee`. Supabase project discovery and details identify `paxonesflows`, ref `eaiwgfxoiwxepinvcykg`, `ACTIVE_HEALTHY`. The account's production-versus-staging designation is still not independently established. No other repository was accessed.
- Investigated the five failures from the previous 15-check batch individually. Four were stale source assertions: tests expected a retired global withdrawal lease, old reconciliation query shape/boundary, and direct scheduling update instead of the current scheduling RPC. Rewrote them against the current durable migration and worker. The fifth was a mislabeled manual audit script: direct `tsx` could not resolve Next's compile-time `server-only`; it silently reported 3/5 and derived reserved index 0. Replaced it with a real three-case positive-index derivation test and ran it through the repository's existing esbuild `server-only` alias. No wallet implementation defect was found in those five failures.
- Withdrawal/reconciliation/sweep-adjacent regression set now **PASS 23/23**; the server-only derivation test **PASS 3/3**. The Playwright browser binary was installed locally using the free Chromium headless-shell distribution. Playwright now uses fixed localhost-only Supabase test configuration, never configured project credentials or URL; E2E **PASS 3/3**.
- Continued deposit registration/ownership checks. Aligned stale tests with the actual current migration filenames, per-worker lease fields, service-role helper, and six-confirmation LTC policy. Focused address/deposit contract suite **PASS 45/45**. The legacy `canonical-deposit-cutover` integration test was blocked by its own guard because no disposable database variables are configured; it was not pointed at the live project.
- Read-only live checks against `eaiwgfxoiwxepinvcykg`: `check_is_admin(uuid,uuid)` remains `authenticated_execute=true` (blocker remains open); `process_deposit_atomic` reports the LTC threshold of six and authenticated EXECUTE=false. Wallet/address tables have RLS enabled, but catalog constraints show no chain-address compound uniqueness and no discovered immutable-identity trigger. `wallets` has unique `(user_id, chain)` and address; `deposit_addresses` unique address and `(user_id, crypto, network)`; `user_deposit_addresses` unique `(user_id, asset_code, network_code)`. Steps 29–30 remain open; no schema changes were made.
- Runtime source scan found no KYT/blockchain sanctions-screening integration in server routes, libraries, or jobs. Keep withdrawal risk-screening readiness open pending an approved provider/attested free screening method; no provider credential or paid service was introduced.
- Full required gate report `local-audit-logs/agentic-quality-gate-20261128-152337.md`: **5/5 PASS** (typecheck, lint, Playwright, Next build, high-severity dependency audit). `git diff --check` passes. No production migration/write, real key access, worker activation, or financial operation occurred. Step 06 stays **IN PROGRESS**, Step 27 stays **OPEN**, and the admin RPC issue remains unresolved. Next: continue wallet identity/uniqueness and risk-screening audits, then steps 31–70 in bounded batches; keep schema verification isolated from production.

## Current repair batch — 2026-11-28 (withdrawal fencing and deposit verification contracts)

- Continued from `main` commit `8f5b374ada5d411dc8000608111bb2844de0fc7b`; preserved prior status. Step 06 remains **IN PROGRESS** and Step 27 remains **OPEN** for custodian approved key-ceremony evidence and public known-index address fixtures. `check_is_admin(uuid,uuid)` authenticated EXECUTE remains a confirmed security blocker; no fix or production migration is claimed.
- Investigated the two withdrawal lease assertion failures. They asserted a retired queue-wide `ownerToken` worker interface; current code uses a per-withdrawal `workerId` and database expiry fence. Updated the two tests to assert current claims and broadcast callsites. No worker or migration implementation was changed.
- Audited deposit ownership, registration, chain evidence, confirmation and credit source contracts. Found stale assertions in `tests/confirmation-worker-chain-verification.test.ts` (floating-point UTXO comparison and LTC threshold 12) and `tests/deposit-lifecycle-safety.test.ts` (superseded migration filename). Current code uses exact integer base units, six LTC confirmations, and the migration exists as `20261123153730_deposit_confirmation_contract.sql`. Updated these tests to match current source/history; no SQL or financial code changed.
- Verification: withdrawal lease/direct-payout/refund/on-chain-idempotency set **PASS 10/10**; deposit lifecycle, pending registration, ingress trust, chain verification, ledger fail-closed, and EVM/TRON/UTXO verifier set **PASS 48/48**; `npm run typecheck` **PASS**; `git diff --check` **PASS**. An initial broad run failed on stale assertions and a superseded migration filename; corrected them and reran successfully. These are source/contract and controlled fixture tests, not a live schema/financial integration run.
- Required quality gate: TypeScript **PASS**, ESLint **PASS**, Next.js production build **PASS**, `npm audit --audit-level=high` **PASS**; Playwright **FAIL** because Chromium `chrome-headless-shell` is not installed locally (three browser cases could not launch). Full report: `local-audit-logs/agentic-quality-gate-20261128-150251.md` (ignored local artifact).
- Verified commit `e1ba0e07f496776039e71229d7be7efe73622bc1` was pushed to `main` after a fresh fetch confirmed `origin/main` at parent `8f5b374a`; post-push local `HEAD` matched `origin/main` and the worktree was clean.
- Further read-only audit attempt: a neighboring 15-test withdrawal/reconciliation/sweep batch reported **10 pass / 5 fail**. Failures are in source-contract assumptions for the retired global withdrawal lease, old reconciliation query boundaries/state selection, and confirmation scheduling; the sweep test runner also cannot resolve the `server-only` package. No source defects are confirmed by these assertion/setup failures. Keep these checks open and inspect their exact current contracts before changing expectations or implementation. No production DB write, migration application, secrets/keys access, worker activation, or real financial/chain operation occurred. Next: reconcile these test contracts; then continue KYT/AML, reservation/sign/broadcast recovery, gas and sweep audits in bounded batches.

## Current repair batch — 2026-11-28 (withdrawal fencing tests and Step 27 evidence)

- Confirmed the checkout is `tkishanmkm/cleanp2p`, `main`, at `8f5b374ada5d411dc8000608111bb2844de0fc7b`, matching freshly fetched `origin/main`; no other repository was accessed. Preserved existing 100-step statuses and Step 06 remains **IN PROGRESS**.
- Investigated the two old withdrawal lease assertions. They described a process-wide lease API (`processWithdrawalQueue(ownerToken)`) that was retired. Current worker code claims each withdrawal with `p_worker_id`, persists per-row ownership, and uses `worker_id` plus `lease_expires_at` fences in SQL before recording normal/ambiguous broadcasts. The helper module `withdrawalWorkerLease.ts` labels itself deprecated and current batch processing calls the per-withdrawal worker directly. Therefore the failures were stale test contracts, not evidence that the current worker should be changed.
- Updated the withdrawal fencing and direct-payout safety tests to match the current per-withdrawal worker ID contract. `npx tsx --test tests/withdrawal-worker-database-fencing.test.mjs tests/withdrawal-worker-direct-payout-safety.test.mjs`: **PASS 7/7**. No withdrawal worker or migration code changed.
- Expanded Step 27 evidence requirements in the original plan: custodian-approved path/coin-account attestation and approved public address-only fixtures for multiple indexes across BTC, LTC, EVM and TRON. Verification must not receive/store a mnemonic, seed, private key, xprv, or recovery material. Step 27 remains **OPEN** pending that evidence; test keys used in local fixtures are disposable only.
- Continued to preserve the security blocker: active `check_is_admin(uuid,uuid)` remains executable by `authenticated`; no remediation is claimed. Isolated PostgreSQL verification remains blocked; production migration gate stays closed. No production financial state, database schema, secrets, worker flags, chain operations, or customer keys were touched.
- This small batch is locally verified but not yet committed or pushed. Next: run withdrawal/refund and durable-broadcast contract tests against existing exact migrations; then continue checks 28–50 (address/registration/deposit/ledger) and 51–70 (withdrawals/gas/sweeps) in separately documented batches. Migration-dependent failures should be investigated against the current repository source/history before classifying them as code defects.

## Current repair batch — 2026-11-28 (six-asset derivation vectors)

- Continued the saved WAYONES plan on `main`; Step 06 remains **IN PROGRESS**. The active production `check_is_admin(uuid,uuid)` authenticated EXECUTE finding remains a security blocker and is not marked fixed. No production database or financial state was changed.
- Completed plan checks 23–26 using a disposable published BIP-39 test mnemonic and independent HD-root derivation in tests: BTC BIP84 mainnet, EVM BIP44 mainnet, LTC BIP84 mainnet, and TRON BIP44/Base58Check. Confirmed the six product views individually: BTC, ETH, LTC, USDT ERC20 (same EVM address), USDT BEP20 (same EVM address), and USDT TRC20. Used child indices 1, 7 and 316. Step 24 documents that USDC/BNB are unsupported and outside the current supported asset set.
- Added deterministic parity coverage to `tests/xpub-address-derivation.test.ts`. Updated `tests/hd-key-management-validation.test.ts`: its prior test incorrectly expected wallet index 0 to pass, contradicting the existing positive-index validator and shared allocator policy. The test now explicitly verifies index zero is rejected.
- Checks: `npx tsx --test tests/xpub-address-derivation.test.ts` **PASS 4/4**; `npx tsx --test tests/hd-key-management-validation.test.ts` **PASS 6/6**; `npx tsx --test tests/canonical-usdt-contract-allowlist.test.mjs` **PASS 2/2**; `npm run typecheck` **PASS**. The derivation vectors use a test-only standard mnemonic, do not read production secrets or create addresses in Supabase.
- Updated the plan: checks 23–26 are complete with disposable fixture evidence; check 27 remains open until production key-ceremony and approved known-index address evidence is available. Isolated DB verification for the admin ACL migration remains blocked, and production execution remains disallowed without approval.
- No commit or push yet. Next independently testable audit: inspect UTXO deposit confirmation identity/reorg and duplicate-output handling (plan checks 38–40, 43–44) or withdrawal/sweep recovery contracts; select the smallest issue-backed batch. No PostgreSQL reinstall attempts were made.

## Current session — 2026-11-28 (wallet ACL blocker and isolated PostgreSQL options)

- Preserved the existing 100-step plan and Step 06 record. Step 06 remains **IN PROGRESS**; this session did not reset or mark completed any checklist item.
- Re-fetched `origin/main`: checkout is `main` at `73fa47e62b53c025bc882eef007d01089a7304b7`, matching remote. The only pre-existing local change is this progress log update from the prior reconnect session.
- Rechecked the active Supabase project's catalog read-only: `public.check_is_admin(uuid,uuid)` is postgres-owned, `SECURITY DEFINER`, empty `search_path`; `anon EXECUTE=false`, `authenticated EXECUTE=true`, `service_role EXECUTE=true`. Current Security Advisor also reports authenticated execution of this function. This is a confirmed security blocker (direct RPC can invoke a privileged predicate) and remains unresolved on the active project.
- Reviewed local candidate `20261104202853_restrict_direct_check_is_admin_rpc_access.sql`: transaction-wrapped, checks function presence, revokes PUBLIC/anon/authenticated, re-grants service_role/postgres/supabase_auth_admin, sets empty search_path. Existing contract test checks those source statements only. It has not been applied to production.
- Free isolated PostgreSQL option investigated: no Docker, `psql`, Supabase CLI, or PostgreSQL installation is present. `winget` lists PostgreSQL 17 (`PostgreSQL.PostgreSQL.17`, 17.12-2) and PostgreSQL 18. Attempted the PostgreSQL 17 install twice through winget; both calls remained at the EDB installer download with no completion, and no `psql`/`initdb`/server binaries or install directory appeared. The installer outcome is unresolved; no database was initialized and no credentials were requested or configured. The connected staging project `cleanp2p-staging` is INACTIVE and was previously recorded as empty, so it is not suitable as-is. No third-party paid database or production project was used.
- No additional wallet repair was made because the highest-priority isolated ACL migration cannot yet be engine-verified, and the nearby source changes require a schema-matched database to avoid speculative SQL. The existing `check-is-admin-acl-migration.test.mjs` passed 1/1 in the prior session; no tests were rerun here. No migration, schema, data, secrets, worker controls, or production state were changed.
- Current next action: resolve the stalled PostgreSQL package install or provide an initialized disposable PostgreSQL target. Then create only minimal roles and a fixture `check_is_admin(uuid,uuid)`, run the migration there, and assert effective EXECUTE grants and function search_path. Continue independent wallet-only source/test audits once the isolated database is ready. Production approval gate remains enabled.

## Current repair batch — 2026-11-28 (six-asset vectors and wallet safety regression review)

- Preserved the 100-step status and Step 06 **IN PROGRESS**. The `check_is_admin(uuid,uuid)` authenticated EXECUTE issue remains a confirmed production security blocker, explicitly **not fixed**. No PostgreSQL installation retries were made.
- Added independent disposable-key BIP-84/BIP-44 parity checks for BTC, LTC, ETH, USDT ERC20, USDT BEP20 and USDT TRC20 at wallet indices 1, 7 and 316. Corrected a stale test which expected reserved child index 0 to pass even though the shared validator rejects non-positive wallet indices. Plan checks 23–26 now have disposable-vector evidence; check 27 remains open for approved production key-ceremony/index fixtures.
- Audited local BTC/LTC deposit verification: checks txid, exact vout index/address/value, confirmed block identity, active-chain hash at that height, and recomputes confirmations from live tip; integrity monitor needs two distinct HTTPS provider origins and reports mismatches for manual review (no automatic balance reversal). Internal-transfer contract tests confirm service-role-only RPC, session-bound sender, account restriction guard, and authoritative fee receipt behavior. Withdrawal refund path validates canonical/finalized receipts and exact durable signer/nonce/payload before settlement/refund.
- Test cleanup: `tests/withdrawal-refund-broadcast-safety-regression.test.ts` expected obsolete variable `p_is_verified_revert` and older confirmation branch forms. Updated the contract assertions to the current fail-closed interface (`p_is_verified_unbroadcast` plus configured finality thresholds); the worker and SQL refund semantics were not changed.
- Verification: derivation/xpub **4/4**, mnemonic/index **6/6**, fixed USDT contract allowlist **2/2**; UTXO, deposit-ingestion, withdrawal-refund, internal-transfer, account-status focused suite **22/22**; `npm run typecheck` **PASS**; `git diff --check` **PASS**. Initial focused attempts also exposed absent migration sources referenced by tests (`20261101160000_fence_deposit_confirmation_workers.sql`, `20261104130000_deposit_confirmation_contract.sql`) and one stale wallet-worker test assertion; these checks were excluded from the final focused pass pending migration reconciliation and test-callsite review. No security rule was weakened.
- Only test files and documentation changed. No application, migration, production data, worker control, signing, broadcast, or financial state changed. No commit/push yet; stage only after final diff review. Further independent tests should restore/locate the exact missing migration source versions before using the migration-dependent tests.
- Additional withdrawal worker lease tests were tried and revealed their old contract assertions still expect `processWithdrawalQueue(ownerToken)` even though current code uses the database lease receipt/owner token through a newer path. Six neighboring assertions passed, two stale caller-shape assertions failed. This was outside the repair batch; worker code was not changed and those checks are not reported green.
- Verified commit `829c99e2508e7a710783575af48fefc938c82236` was pushed to `main` after targeted tests, TypeScript, staged diff review, and a fresh pre-push `origin/main` check. Post-push `HEAD` equals `origin/main`; worktree is clean.

## Current session — 2026-11-28 (reconnect and admin ACL verification)

- Reconnected to the intended `tkishanmkm/cleanp2p` checkout. Branch `main` is clean at `73fa47e62b53c025bc882eef007d01089a7304b7`, identical to freshly fetched `origin/main`. No unrelated repository was accessed.
- Read the existing `docs/audits/wayones-100-step-completion-plan-20261122.md` and Step 06 record `docs/audits/wayones-step-06-wallet-provisioning-integration-20261121.md`. Step 06 remains **IN PROGRESS**; the existing 100-step checklist is preserved and no step status was reset.
- Inspected `supabase/migrations/20261104202853_restrict_direct_check_is_admin_rpc_access.sql` and its contract test. The migration checks that the exact function exists, revokes `PUBLIC`, `anon`, and `authenticated`, retains only `service_role`, `postgres`, and `supabase_auth_admin`, sets an empty `search_path`, and runs in a transaction. This is source review only; it does not establish PostgreSQL runtime safety.
- Ran `node --test tests/check-is-admin-acl-migration.test.mjs`: **PASS, 1/1**. `git diff --check`: **PASS**. The test validates migration text, not function privilege behavior in PostgreSQL.
- Isolated database validation remains blocked: `docker`, `psql`, and Supabase CLI are unavailable locally; the connected `cleanp2p-staging` project was previously recorded as empty and unsuitable for schema-matched verification. The active `paxonesflows`/`paxonesflow` project was not written to. The latest available live read-only catalog evidence still records `authenticated EXECUTE` on `check_is_admin(uuid,uuid)`; production ACL change remains pending explicit approval and supported migration process.
- No code or SQL was changed, no commit/push/deployment occurred, and no production state or financial operation was touched. Next action: obtain an initialized disposable PostgreSQL/Supabase test target or local PostgreSQL tooling, execute the migration against a fixture function, then assert role privileges and `search_path` before considering any production request.

Updated: 2026-10-17
Branch: `fix/production-typecheck-batch-1`

## Current run status

The runner argument conflict was fixed: `--approve-for-me` cannot be combined with `--sandbox`. The runner now passes the prompt through a closed stdin pipeline to avoid Codex waiting indefinitely for input and requests `--sandbox workspace-write` without the incompatible flag.

However, repeated Codex CLI runs report `approval: never` and `sandbox: read-only`; the controlled diagnostic command was rejected by policy before execution. Codex itself made no application fixes, and no temporary-file write test was performed. The two Next.js route-export errors described below were fixed directly with Desktop Commander. Do not treat a Codex exit code of 0 as proof that the requested work was completed. The runner's detector now includes `blocked by policy`, `approval: never`, and related read-only markers; end-to-end verification is still pending.

## Free-tier guardrail

Keep automation on local/free tools and the user's existing free-tier allowances. Do not add paid subscriptions, metered API keys, paid scanners, paid cloud resources, or paid trials without explicit approval. ChatGPT-authenticated Codex can have account-specific limits and feature restrictions; no unlimited usage is assumed. Free tiers can impose quotas and rate limits, so verify provider terms before enabling external services.

## Latest direct code batch (Desktop Commander)

- Extracted `CoinBadgeLogo` from the Next.js wallets page module into `src/components/wallets/coin-badge-logo.tsx`, then updated the wallets and transfer pages to import it from the shared component. This fixes an invalid named export from a Next.js page module without changing its rendered behavior.
- Removed the unused `deriveEvmAddress` route re-export and unused HD-engine imports from `src/app/api/wallet/deposit-address/route.ts`. This fixes an invalid named export from a Next.js route handler.
- Security audit of both deposit-address routes found they accepted caller-supplied `x-user-id` / `user_id` as identity, and the plural route returned deterministic index-1 addresses to unauthenticated callers. This could let a caller request another user's address or cause users to send funds to a shared preview address. The singular route now uses only verified Bearer-token or Supabase-cookie identity and returns 401 otherwise. The plural route no longer accepts the `user_id` query override or returns shared default addresses; it returns 401 without verified auth. Removed its hard-coded Supabase project URL and placeholder auth key; missing configuration now fails closed. Callers were reviewed: the deposit dialog sends the session token and same-origin cookies, while other wallet hooks use same-origin cookies and/or the current session token. These changes were not tested against a live Supabase project.
- Fresh `npm run typecheck`: **FAIL**, with 83 TypeScript diagnostic lines (baseline 85). The invalid Next.js route/page export errors are gone. Remaining errors include nullability in test scripts, a missing Genkit package, profile/ad type mismatches, undefined `numericCrypto`, wallet/withdrawal type issues, bigint arithmetic, Supabase query typing, trade message/status mismatches, and duplicate `avgReleaseTime`.
- Targeted ESLint on the changed pages, both deposit-address routes, and new component: **PASS with 7 security-plugin warnings and 0 errors**. Warnings remain to be triaged; they are not automatically confirmed vulnerabilities.
- `git diff --check`: **PASS**, with Git line-ending warnings for `.eslintrc.json`, `.gitignore`, and `AGENTS.md`.
- No dedicated regression tests have been added for these changes yet. Typecheck and static lint passed for the changed files, but runtime authentication behavior still needs isolated tests before deployment. No commits or pushes were made.

## Verified baseline

- Branch: `fix/production-typecheck-batch-1` tracking `origin/fix/production-typecheck-batch-1`.
- Existing user changes were preserved. No commit, push, merge, deployment, or production Supabase/financial operation occurred.
- Node: `v24.20.0`; npm: `11.19.0`.
- `npm run typecheck`: **FAIL** after 31.5 seconds, with numerous errors including invalid Next.js route exports (`CoinBadgeLogo`, `deriveEvmAddress`), nullability in test scripts, missing `@genkit-ai/google-genai`, ad/profile type mismatches, undefined `numericCrypto`, missing `UserWallet`, withdrawal prop/type errors, number/bigint arithmetic in `withdrawalWorker`, `TransactionReceipt.effectiveGasPrice`, invalid Supabase builder `.catch`, `MODERATOR_JOINED` union mismatch, duplicate `avgReleaseTime`, and missing `WithdrawalTask.network_code`.
- `git diff --check`: passed; Git printed line-ending warnings for `.eslintrc.json`, `.gitignore`, and `AGENTS.md`.
- Prior full quality gate recorded: ESLint pass with security warnings; browser E2E 2 passed / 1 failed (homepage navigation timeout / `ERR_ABORTED`); production build passed while explicitly skipping type validation; `npm audit --audit-level=high` failed with 19 vulnerabilities (1 critical, 13 high, 5 moderate).
- No environment variable names matching Supabase, `DATABASE_URL`, or `TEST_APP_URL` were present in the inspected environment. This does not prove production secrets are absent elsewhere.

## Latest next-step batch: ZAP install and trade-initiation hardening

- Installed OWASP ZAP **2.17.0** using Windows Package Manager and installed Eclipse Temurin Java 21.0.12.1. Verified the Java runtime directly and confirmed ZAP reported version `2.17.0`. Added the Java runtime `bin` directory to the current user's PATH so the ZAP launcher can find Java in new shells. No paid tools or subscriptions were added. ZAP has not yet scanned the application.
- In `src/components/p2p/trade-initiation-modal.tsx`, defined and validated `numericCrypto`, generated a per-attempt idempotency key, and sent it in the request body/header. Removed the direct Supabase `trades` insert and minimal-schema fallback. Trade initiation now fails closed if the secure API/RPC path fails instead of creating a potentially unescrowed trade.
- In `src/app/api/trades/initiate/route.ts` and `src/app/api/trades/create/route.ts`, removed client-controlled rate and fiat-currency overrides and use the stored ad's price/currency. The initiate route also rejects missing/invalid ad limits and enforces stored fiat limits; both routes now type-check idempotency keys before trimming. The initiate route's placeholder Supabase URL/key fallback and verbose auth debug response were removed. The canonical SQL escrow RPC still requires verification against both ad data sources and account restriction rules. Static review of the latest RPC migration found explicit emergency-freeze checks but no explicit `is_banned`, `is_restricted`, or `account_status` checks in that function. Because authenticated clients can invoke the granted RPC directly, the API route guard alone is not a sufficient enforcement boundary. Treat banned/restricted-user trade prevention as a **critical unresolved production blocker** until a database-level fix and regression tests are prepared and reviewed.
- Fixed the duplicate `avgReleaseTime` declaration in `src/lib/types.ts` and corrected the EVM withdrawal gas-asset lookup to use `WithdrawalTask.network` instead of a nonexistent `network_code` property in `src/lib/withdrawal-processor.ts`.
- Fresh `npm run typecheck`: **FAIL**, with 72 TypeScript errors remaining (the previous run reported 83 diagnostic lines). The `numericCrypto`, duplicate `avgReleaseTime`, and `WithdrawalTask.network_code` errors are no longer present. Missing Genkit dependency, profile/ad type mismatches, wallet/withdrawal issues, bigint arithmetic, Supabase builder typing, and other trade/status errors remain.
- Targeted ESLint on the trade modal, trade initiation route, shared types, and withdrawal processor: **PASS with 0 errors and 1 React hook dependency warning**. `git diff --check`: **PASS**, with existing line-ending warnings. No runtime tests against Supabase, no real chain transaction, no ZAP scan, and no financial operation were performed.
- No commit, push, merge, or deployment occurred.

## Latest next-step batch: database-level trade account restrictions

- Added `supabase/migrations/20261017010000_enforce_trade_account_restrictions.sql`, a new additive migration that replaces the existing `public.initiate_trade_with_escrow` function without changing its signature or financial logic.
- The function now checks the caller's profile before idempotency replay and new trade creation. It fails closed if the profile is missing or if `is_banned`, `is_restricted`, `is_on_hold`, `is_suspended`, or `account_status` indicates a restricted/non-active account.
- New trade creation also checks the advertisement owner's profile inside the database function and rejects restricted/non-active counterparties. This is database-level enforcement, not just an API route guard.
- Static migration assertions passed for the restriction checks, expected grant/revoke signature, and transaction terminator; `git diff --check` passed with existing line-ending warnings. No `psql` or Supabase CLI executable was detected, so the SQL has **not** been parsed by a PostgreSQL engine, applied to Supabase, or tested with real fixture accounts. Treat it as prepared but not yet database-verified.
- No live Supabase data was changed. No commit, push, merge, or deployment occurred.

## Latest next-step batch: TypeScript cleanup

- Fixed public profile typing by adding the optional `verification_tier` property and mapping presence timestamps only from `last_seen_at`, which is the column actually selected by the query. This removed the `verification_tier`, `last_seen`, and `last_active` TypeScript errors.
- Replaced an invalid `.catch()` call on a Supabase PostgREST builder with awaited result/error handling for the optional legacy `advertisements` mirror in `pauseAllAds`.
- Updated Ethers v6 receipt gas accounting to use the supported `receipt.gasPrice` property rather than nonexistent `effectiveGasPrice`.
- Added `MODERATOR_JOINED` to the `SystemMessagePayload.type` union because the formatter already handles that event.
- Fresh `npm run typecheck`: **FAIL, 63 TypeScript errors remaining**, down from 72 in the previous run. The three issues above and the user profile typing issues no longer appear in the error output.
- Targeted ESLint: **0 errors**, 15 warnings across the inspected files (including existing `<img>`, generic object-indexing, and unsafe-regex warnings). `git diff --check`: **PASS** with existing line-ending warnings.
- Removed the placeholder Supabase URL/key fallback in `src/middleware.ts`. When Supabase configuration is absent or clearly a placeholder, public entry/static pages can render while non-public routes/APIs return 503 instead of attempting network requests against a fake Supabase host. This is fail-closed configuration handling; the environment still needs valid Supabase variables for normal protected use.
- Verified the local Next.js server is bound to `127.0.0.1:3000`; `/login` returned HTTP 200 in 0.62 seconds after the middleware guard change. Before the change, the same local request timed out at 15 seconds while middleware used placeholder configuration. This is a useful local smoke test, not a complete app test.
- Started OWASP ZAP 2.17.0 in daemon mode bound to `127.0.0.1:8090`, but the ZAP API did not become reachable and no spider/passive scan completed. ZAP is installed; scanning remains outstanding. Do not describe the app as ZAP-scanned yet.
- Targeted ESLint on middleware and recently fixed helper files: **0 errors**, 6 security-plugin warnings remain in blockchain providers and trade system messages. `git diff --check`: **PASS** with existing line-ending warnings.
- The SQL migration remains static-checked only; no PostgreSQL parser/runtime or Supabase migration was available. No live financial operations, commit, push, merge, or deployment occurred.

## Latest next-step batch: wallet UI and admin navigation type cleanup

- Added a UI-specific `UserWallet` type to `src/lib/types.ts` for the asset/network balance rows consumed by `WalletDisplayCard` (kept distinct from the database record type in `src/lib/supabase/db.ts`).
- Fixed `WalletDisplayCard` to pass the selected coin through the actual `WithdrawDialog` API (`asset={coin}`) rather than passing an unsupported `wallet` prop. Withdrawal balance authority continues to come from the existing wallet context.
- Corrected the admin sidebar to use the existing `SidebarMenuButton` API: icons are now children, links use `asChild`, and logout icon is rendered as a child instead of an unsupported prop.
- Fixed counterparty profile selection to include the `blocked_users` column that the component reads, removed an unsafe email-verification fallback that effectively marked missing status as verified, and guarded feedback lookup against an undefined profile ID.
- Targeted ESLint across the touched wallet/sidebar/profile files: **0 errors**, 10 existing security-plugin object-indexing warnings in wallet dialogs. `git diff --check`: **PASS** with existing line-ending warnings.
- Fresh `npm run typecheck`: **FAIL, 51 TypeScript errors remaining**, down from 60 at the start of this batch. The sidebar prop errors, missing `UserWallet` export errors, withdrawal price-index errors, and counterparty panel's optional identifier / mixed `||` and `??` errors are resolved.
- Targeted ESLint after final adjustments: **0 errors**, 12 security-plugin object-indexing warnings in wallet dialogs. `git diff --check`: **PASS** with existing line-ending warnings.
- No live Supabase data was changed. No commit, push, merge, or deployment occurred.

## Latest next-step batch: remaining TypeScript cleanup and Genkit wiring

- Added explicit null guards in trade-feedback regression scripts so missing trade/profile records fail with clear test errors instead of unchecked property access.
- Corrected ad-card seller-profile types and payment/tag mapping callbacks, fixed nullable profile fields in ad creation, and corrected session mapping and the supported Alert variant.
- Fixed profile avatar fallback to use fields present on the shared `User` type, narrowed blocked-user list state to the fields the component actually renders, and corrected the profile page import target.
- Fixed off-platform chat feedback to use the detector's actual `matchedTerm` property and removed a redundant impossible trade-status comparison.
- Corrected BTC/LTC fee fallback parsing by typing mempool input/output records before summing satoshi/litoshi values with `bigint`.
- Added the missing compatible Genkit dependencies (`genkit@1.42.0` and `@genkit-ai/google-genai@1.42.0`) and corrected imports so `genkit` comes from `genkit` while `googleAI` comes from the provider plugin. This enables the existing crypto-price flow to typecheck; runtime still requires valid Google AI credentials and provider availability.
- Fresh `npm run typecheck`: **PASS, 0 TypeScript errors**. Targeted ESLint on the touched files: **0 errors, 17 warnings** (security object-indexing, existing React hook dependency warnings, and `<img>` optimization warnings). `git diff --check`: **PASS** with existing line-ending warnings.
- `npm run build`: **PASS, exit code 0** after compiling and generating 125 static pages. The build logs `Skipping validation of types` and `Skipping linting` because `next.config.js` explicitly sets `typescript.ignoreBuildErrors` and `eslint.ignoreDuringBuilds`; standalone typecheck and targeted ESLint were therefore run separately. Build also reports Node `crypto` imports from `admin-2fa-session.ts` and `user-2fa-session.ts` in Edge Runtime imports; this needs runtime/security review because middleware calls those verification functions.
- Build page-data collection logged dynamic-server-usage messages for `/api/admin/security/status` and `/api/auth/2fa/status` when Next tried to prerender routes that read cookies. The overall build completed, but these route-specific messages should be reviewed and the routes explicitly marked dynamic if appropriate.
- Dependency installation initially reported 79 vulnerabilities. After updating Next.js within major 14 to `14.2.35` and running non-force `npm audit fix`, the current production-only audit still fails with **75 vulnerabilities (57 moderate, 17 high, 1 critical)**. The critical Next.js advisories currently recommend `next@16.4.2`, a major-version change; no `--force` upgrade was performed because it can pull in breaking Next/Tailwind changes. A planned Next/React major migration and compatibility tests are required before launch. Four packages still have install scripts not approved by npm's install-script policy.
- No live Supabase data was changed. No commit, push, merge, or deployment occurred.

## Current blocker

Codex CLI is authenticated (`Logged in using ChatGPT`) but the autonomous runner invocation remains restricted to read-only despite requesting `--sandbox workspace-write`. Desktop Commander was used for these explicit local edits and checks; this does not provide an unattended autonomous loop.

## Next actions

1. Verify the Codex CLI's effective sandbox/approval policy on this machine; do not bypass the sandbox using dangerous unrestricted flags.
2. Confirm the runner fails nonzero when Codex reports a read-only/policy blocker or makes no verifiable progress.
3. In a writable, appropriately scoped agent run, fix TypeScript errors in small batches with regression coverage.
4. Diagnose the Playwright homepage failure and triage critical/high dependency vulnerabilities without blind force upgrades.
5. Audit wallet, deposit, withdrawal, sweep, broadcast, transfer, escrow/trade, and ads security using static review and isolated tests only.
6. Rerun all relevant quality gates and report evidence. Production readiness is not established.


## Latest next-step batch: safer chat access, usage bounds, retention preparation, and reproducible builds

- Secured `GET /api/trades/[tradeId]/system-message`: it now requires an authenticated user, resolves the trade, and only returns system messages to a buyer/seller participant or a verified admin from trusted app metadata/server-owned profile fields.
- Removed unsafe administrator detection from the same route that trusted editable `user_metadata` and any email ending in `@paxones.com`. The POST route now uses trusted app metadata or the server-owned profile role/flags.
- Added 20-row server-side bounds to the user trade-list APIs and the user's ads-list API paths. This limits returned list payloads; it is not yet a database-enforced cap on how many ads a user can create.
- Notification listing now excludes items older than 30 days. A local-only SQL migration adds a daily Supabase Cron retention job to purge notifications older than 30 days and chat messages for terminal, undisputed trades after 30 days.
- Prepared `supabase/migrations/20261017170500_trade_chat_message_limits_and_retention.sql` to enforce a transaction-serialized 100-human-message limit across `trade_messages` and `trade_chat_messages`, prevent ordinary users from spoofing moderator labels, and provide a support@paxones.com / trade-ID error when the limit is reached. It also adds the notification query index and retention function. This migration has **not** been applied to Supabase; the connected staging project is empty and no isolated PostgreSQL runtime is available, so the SQL still needs engine-level validation and regression tests before any deployment.
- Removed the Next.js build configuration that skipped TypeScript and ESLint checks. Updated `eslint-config-next` to match Next.js `14.2.35`.
- Replaced build-time Google Fonts fetching with the same Inter and Source Code Pro font families self-hosted via `@fontsource` packages. This avoids production-build dependence on a request to `fonts.gstatic.com`; the existing locale strings were not changed.
- Verification after the system-message security change and initial list bounds: `npm run typecheck` **PASS**; targeted ESLint **PASS** (warnings only); `git diff --check` **PASS** with existing Windows line-ending warnings. The full typecheck/lint/build gate is currently running after the local-font change; its final result will be recorded once the process completes.
- Supabase production schema inspection confirms `pg_cron` is installed and the canonical trade/chat tables use different `trade_id` types (text in `trade_messages`, UUID in `trade_chat_messages`). The migration accounts for both types and excludes system UUID messages from the 100-message count. No live SQL was run to mutate data.
- Current Supabase Free quotas from official docs: 500 MB database size, 1 GB storage, 50,000 monthly active users, 500,000 Edge Function invocations, 2 million Realtime messages per month, and 5 GB cached plus 5 GB uncached egress. The 2-million figure is a **monthly Realtime quota**, not a lifetime database-row cap; retention helps stored-data size but does not reset monthly Realtime usage. A 1,000-MAU target is within the published MAU allowance, but actual feasibility depends on chat fan-out, egress, database size, and request volume.
- No production database changes, commits, pushes, merges, or deployments were made.


- Also prepared `supabase/migrations/20261017170600_enforce_user_active_ad_limit.sql`: a database trigger caps each user at 20 active ads across `ads` and `p2p_ads`, deduplicates mirrored records by public ad ID, and locks the user's profile row to prevent concurrent requests from racing past the cap. It was based on read-only inspection of the actual column types and existing user indexes. It is local-only and has not been applied or engine-tested.


## Latest next-step batch: Edge-compatible 2FA verification

- Removed the Node `crypto` session modules from the middleware import graph and added `src/lib/2fa-session-edge.ts`, which verifies HMAC-SHA256 2FA cookies using Web Crypto and fails closed if the dedicated signing key is absent or invalid. Token creation remains in the Node.js session modules.
- Fixed a token-format bug: ISO timestamps used as the 2FA security-version tag contain colons, but the old token format also used colons as separators. The timestamp was therefore split into extra fields and the token rejected. New tokens URI-encode the version tag; both Node and Edge verifiers decode it before checking that the 2FA security version still matches.
- Marked the cookie-reading admin and user 2FA status endpoints `force-dynamic` so Next.js does not try to prerender them.
- Added `tests/2fa-session-edge.test.ts` to the security test suite. It checks admin and user token creation, Edge Web Crypto verification, ISO timestamp version tags, user binding, and invalidation after security-version rotation.
- Verification: the new 2FA compatibility test **PASS**, `npm run typecheck` **PASS, 0 errors**, targeted ESLint **PASS** (one security-plugin object-indexing warning in the new verifier), and `git diff --check` **PASS** with existing line-ending warnings. A full lint/build run is now underway to verify that the Edge-runtime crypto and dynamic-route build warnings are resolved.
- No production database changes, commits, pushes, merges, or deployments were made.


- Final full gate after the Edge 2FA refactor: `npm run lint` **PASS** (existing security-plugin warnings only), `npm run build` **PASS** with build-time TypeScript/ESLint checks enabled, 123 static pages generated, and `git diff --check` **PASS**. The final build log contains no Node-crypto-in-Edge warning and no 2FA `DYNAMIC_SERVER_USAGE` warning. This verifies the build, not production runtime behavior or database migrations.


## Latest next-step batch: account lifecycle, offline-ad protection, and chat quotas

- Added local-only 20261017170700_account_deletion_grace_period.sql plus /api/user/delete-account safeguards: a 20-day deletion grace period, immediate account lock, preserving the profile/username tombstone and Auth email, pausing the user's ads, checking for open/disputed trades before scheduling deletion, and a service-only cleanup queue for profile media/Auth metadata. The scheduled cleanup route is protected by CRON_SECRET and retries failures. No migration has been applied to the live Supabase project.
- Added local-only 20261017170800_deactivate_ads_after_offline_attempts.sql and route-level checks on all three trade initiation endpoints. The database function checks authenticated buyer status, deduplicates retries by idempotency key, rate-limits repeat offline attempts from the same buyer, tracks attempts across canonical/legacy ad rows, pauses the ad after three qualifying offline attempts, and inserts a notification. A database trigger blocks direct authenticated trade inserts when the seller's presence heartbeat is stale, so the API check alone is not the security boundary.
- The offline-ad notification uses a metadata code so the app can render its title/message in the selected locale. Added translations for the new offline-ad and chat-limit messages across all 13 locale files without changing existing locale sentences. Moved I18nProvider above NotificationsProvider so realtime notification toasts use the actual selected language.
- Fixed notification retention in src/lib/notifications.ts from 10 days to 30 days, carried notification metadata through the data mapping, and kept the 30-day SQL retention job. Trade list endpoints are bounded to 20 rows; the active-ad database trigger enforces 20 active ads across ads and p2p_ads. The trade chat is capped at 100 logical human messages per trade, with support@paxones.com and trade ID guidance when the limit is reached.
- Corrected the active-ad trigger's update accounting so a mirrored ad with the same public ID is not counted twice when editing; the insert path only permits a same-owner mirror across the two tables, not reusing a public ID within the same table or across different owners.
- Read-only Supabase schema inspection confirmed the profile/ad/chat/notification columns and the pg_cron, pg_net, and Supabase Vault extensions exist. The new SQL remains unexecuted and has not been validated by a local PostgreSQL engine; it must be tested in an isolated database before deployment. No live wallet, escrow, trade, or account data was modified.
- Latest local quality gate: locale JSON validation PASS (13 files); npm run typecheck PASS (0 errors); tests/2fa-session-edge.test.ts PASS; full npm run lint PASS (warnings remain); npm run build PASS; git diff --check PASS with Windows line-ending warnings. Build generated 123 static pages.
- Remaining blockers: production-only npm audit previously reported 75 vulnerabilities (1 critical, 17 high, 57 moderate), including a critical Next.js advisory requiring a planned major-version migration; full OWASP ZAP scan is still incomplete; the new SQL migrations still need isolated integration/regression tests; no full wallet/escrow chain integration tests have been completed. The platform is not yet production-ready.
- No commit, push, merge, deployment, or live Supabase migration was performed.

- Added docs/FREE-TIER-CAPACITY-PLAN.md with a conservative 1,000-MAU beta budget, message/Realtime estimates, 50%/75% usage alerts, database/egress guardrails, and the explicit warning that Free-tier quotas do not guarantee capacity or production financial-service reliability.
- Re-ran non-force npm audit fix: it added 9 packages and changed 2, but the latest production-only audit still reports 75 vulnerabilities (57 moderate, 17 high, 1 critical). No force upgrade was used; the Next.js major migration remains a separate compatibility task. A fresh quality gate is running against the updated dependency tree.

- Post-audit-fix verification completed: production dependency audit still fails with 75 vulnerabilities (57 moderate, 17 high, 1 critical); typecheck **PASS, 0 errors**; 2FA Edge regression test **PASS**; full lint **PASS, warnings only**; production build **PASS** on Next.js 14.2.35; `git diff --check` **PASS** with Windows line-ending warnings. The build generated 123 static pages. The dependency tree was updated without `--force`; no major Next.js migration was attempted.


## 2026-10-18 — Production hardening follow-up (read-only live audit + local SQL corrections)

- Read-only inspection of the configured Supabase projects found `cleanp2p-staging` has no listed migrations or public tables, so it is not currently a usable isolated clone for migration execution. No migrations were applied to either project.
- Read-only schema checks on `paxonesflows` confirmed the profile status/presence fields and canonical/legacy ad identifier fields referenced by the pending SQL exist.
- Supabase Security Advisor currently reports 18 `SECURITY DEFINER` functions callable by `authenticated`. This is a review queue, not proof that all 18 are exploitable: several contain internal authorization checks. Review each function's caller identity and target-ID handling before changing grants. Advisor also reports three RLS-enabled 2FA/security tables without policies; that is fail-closed for API roles, but verify service-only access and intended use.
- Confirmed the live `initiate_trade_with_escrow` definition has caller and counterparty eligibility checks, including restricted/suspended/banned/minor-restricted and non-active status handling. No live function was changed.
- Corrected pending local migration `20261017010000_enforce_trade_account_restrictions.sql` to fail closed when `account_status` is null or anything other than `active`, and to enforce `is_minor_restricted` for both caller and counterparty.
- Corrected pending local migration `20261017170800_deactivate_ads_after_offline_attempts.sql` to resolve canonical `ads.public_id` as well as `id`/`public_ad_id`, and to carry the resolved public identifier into cross-table mirroring.
- Targeted static assertions passed for caller/counterparty minor restriction handling, fail-closed account status, and canonical `public_id` resolution. `git diff --check` passed; only standard Windows LF/CRLF warnings were emitted.
- These are static checks only. No isolated PostgreSQL engine validation was possible because the available staging project is empty and no local `psql`/Supabase CLI was found. The pending migrations remain unapplied and must not be treated as production-active.
- Next: provision/identify a real isolated schema with the correct baseline migrations, validate these SQL changes there, then review the Security Advisor function-grant findings individually before any live migration.
- Follow-up review found a correctness bug in the pending offline-ad trigger: checking `NEW.seller_id` does not reliably identify the owner of a BUY advertisement. Updated the trigger to resolve the owner from canonical `public.ads` using the trade's ad ID/public identifier, fail closed if the ad/profile is missing, and check that owner's 120-second presence heartbeat. This remains a local SQL change.
- Static assertions for the updated trigger passed (owner lookup, fail-closed handling, hardened `search_path`, heartbeat threshold, transaction closure); `git diff --check` passed with Windows line-ending warnings. No `psql`, Supabase CLI, or Docker executable was found on the remote workstation, so SQL syntax/runtime validation is still pending.
- Current live Supabase advisor review remains open: 18 authenticated-callable `SECURITY DEFINER` functions need function-by-function authorization review; the performance advisor also flags unindexed foreign keys, duplicate indexes, and multiple permissive RLS policies. No blanket grant revocations or index drops were made because those require dependency and access-path verification.
- Found no application/Edge-function caller for the legacy `initiate_didit_kyc(uuid,text)` RPC in the local source tree. Because it accepts an arbitrary target user ID and vendor session ID, its default PUBLIC execute exposure is not appropriate. Added local-only migration `20261018100000_restrict_didit_kyc_rpc_execution.sql` to revoke PUBLIC/anon/authenticated execution, grant only `service_role`/`postgres`, and clear its SECURITY DEFINER `search_path`. Validate any external caller dependency before deployment; this migration has not been applied.
- Static assertions for the KYC grant migration passed; `git diff --check` passed with only Windows line-ending warnings. No database writes, commits, pushes, or deployments were made.


## 2026-10-18 — transfer/ad write-permission hardening (local-only)

- Read-only inspection of the connected Supabase project found that `p2p_ads` had an INSERT policy granted to `PUBLIC` (with an `auth.uid()` owner check), and `transfers` had a public-role INSERT policy that only checked `sender_id`. That check is insufficient for financial rows because a client could attempt to forge transfer amount, fee, status, or other fields if direct table insertion were allowed.
- Added `supabase/migrations/20261018110000_restrict_public_financial_write_policies.sql` locally:
  - ad creation is explicitly scoped to `authenticated` users and keeps the owner check;
  - direct `transfers` INSERT is revoked from `PUBLIC`, `anon`, and `authenticated`; the trusted service role remains able to write rows through the atomic transfer RPC.
- The app's transfer API uses `execute_internal_transfer` RPC rather than a direct insert. Live database was not changed.
- Next required verification: test this migration against a disposable/staging database that has the full schema; the connected `cleanp2p-staging` project currently has no public tables or recorded migrations, so it is not ready to validate this migration as-is.
- Production project remains not production-ready: security/performance advisors reported many RLS/policy warnings and duplicate indexes; findings need triage rather than bulk policy/index deletion.


## 2026-10-19 — dependency patching and live transfer-policy audit

- Read-only audit of the connected `paxonesflows` database confirmed the current transfer table still has a PUBLIC-scoped insert policy checking only `auth.uid() = sender_id`, plus duplicate service-role policies assigned to PUBLIC. Although the transfer RPC itself is restricted to `service_role`, direct table insert grants/policies are an unnecessary financial-record integrity risk.
- Refined local-only migration `20261018110000_restrict_public_financial_write_policies.sql`: direct transfer inserts are revoked from PUBLIC/anon/authenticated; the trusted service role gets one explicitly role-scoped write policy; duplicate participant-read policies are consolidated into one authenticated sender/recipient policy; ad creation stays authenticated-owner-only. Static checks confirm transaction boundaries, expected policy/grant changes, and no table/data-destructive statements.
- No live migration was applied. `cleanp2p-staging` remains empty (no public tables or migration history), so there is still no safe full-schema staging target for integration validation.
- Updated `tronweb` within the existing compatible semver range (6.3.0 → 6.5.1). The production-only dependency audit improved from 75 findings (1 critical, 17 high, 57 moderate) to 73 (1 critical, 16 high, 56 moderate). This does **not** clear the critical Next.js advisory; do not use `npm audit fix --force`. A deliberate Next/React major migration and regression run are still required.
- TypeScript typecheck passed (0 errors); `tests/2fa-session-edge.test.ts` passed; `git diff --check` passed with Windows LF/CRLF warnings. Full lint/build were started for this updated dependency tree and must be confirmed in their logs before marking the gate complete.
- The full remote-backed test suite cannot pass in the current local environment: requests resolve to a placeholder Supabase host, and the required service-role credential is absent. Tests reported fetch failures and zero integration cases passing. Do not put secrets into logs or commit them; configure valid local test credentials against an isolated project before rerunning. No live user data was changed.
- Current production blockers remain: critical/high dependency advisories; live transfer-write policy fix not deployed; pending SQL migrations not engine-tested; empty staging project; remote financial integration tests unavailable; full ZAP scan incomplete; no production load/reconciliation drill. App is **not production-ready**.

- Updated-tree final gate completed: `npm run lint` **PASS** (warnings only), `npm run build` **PASS** on Next.js 14.2.35 with 123 static pages, `npm run typecheck` **PASS**, and the 2FA Edge regression test **PASS**. `git diff --check` passes apart from Windows line-ending notices. Remaining ESLint warnings include object-injection patterns, unsafe-regex notices, missing React hook dependencies, and unoptimized `<img>` usage; these need targeted review rather than blanket suppression.

## 2026-10-19 — Next.js security upgrade validation

- Upgraded Next.js and `eslint-config-next` to **15.5.28** (security-patched 15.x), keeping React 18 within Next's declared peer range. No `--force` upgrade was used. `npm dedupe` refreshed compatible transitive dependencies.
- Migrated affected server-cookie access to `await cookies()` and updated dynamic route/page params to Next 15's Promise-based contract, including the four P2P trade action handlers.
- Final Next.js 15.5.28 production build **PASS**: compiled successfully, type validation passed, static generation completed (47 static pages; remaining routes dynamic), and route manifests/traces finalized. Lint passes with existing warnings; 2FA Edge regression test passed after the dependency upgrade.
- Current production-only audit: **73 findings — 0 critical, 15 high, 58 moderate**. The critical Next.js finding is no longer present. Remaining high findings include Genkit/OpenTelemetry dependency chains, `axios`, `tronweb`, and Tailwind-related packages; safe non-major fixes will be investigated next. Do not force Tailwind CSS 4 or a Next 16 jump without a planned migration.
- These results are local only. The source tree remains uncommitted on the existing feature branch; no GitHub push/merge/deployment and no live Supabase migration occurred. Existing lint warnings and all database/integration/security blockers still prevent a production-ready declaration.


## 2026-10-19 — safe dependency overrides and Supabase advisor follow-up

- Applied compatible, pinned npm overrides for Axios and PostCSS using the root dependency versions: `axios@1.20.0` and `postcss@8.5.31`. Verified `npm ls axios tronweb postcss --all` resolves cleanly; TronWeb now dedupes to Axios 1.20.0 and Next.js 15.5.28 uses the patched PostCSS 8.5.31.
- Production-only dependency audit improved again to **69 findings: 0 critical, 12 high, 57 moderate**. Remaining high findings are primarily Genkit/OpenTelemetry chains with no compatible fix reported by npm, plus Tailwind CSS 3 transitive findings whose advertised fix requires Tailwind CSS 4. Do not force a major update; investigate a separate Genkit/OpenTelemetry compatibility plan and Tailwind 4 migration.
- Re-ran TypeScript typecheck and the 2FA Edge regression test after dependency overrides: both **PASS**. Re-ran the full Next.js 15.5.28 production build after the dependency tree was repaired: **PASS**, with static generation complete and no build/type errors. Existing ESLint warnings remain and are not suppressed.
- Read-only Supabase advisors report 18 authenticated-callable SECURITY DEFINER RPCs, 3 RLS-enabled tables with no policies (security INFO), 5 unindexed foreign keys, and 38 RLS-initplan performance notices. Reviewed privilege metadata: the reported RPCs are not executable by `anon`; high-impact admin/trade RPCs reference caller/admin checks, and `initiate_trade_with_escrow` references banned/restricted/account-status guards. The linter notices still require individual function-body review and policy intent verification; do not treat them as automatically safe solely from keyword checks.
- Added local-only migration `20261019100000_add_financial_fk_indexes.sql` for the five advisor-reported FK columns: `deposits.user_id`, `platform_ledger_entries.related_user_id`, `profiles.emergency_frozen_by`, `sweep_queue.user_id`, and `utxo_reservations.sweep_id`. Read-only catalog inspection confirmed no existing indexes cover these columns; affected tables are currently small. Migration is not applied to the live project.
- No GitHub commit/push/merge/deployment or live Supabase DDL was performed. The current local branch still contains the working batch uncommitted. Production readiness remains blocked by the 12 production high-severity advisories, remaining moderate advisories, SQL migrations not validated/applied through a safe staging environment, missing valid local Supabase test credentials, incomplete financial end-to-end/load tests, and incomplete ZAP scanning.


## 2026-10-19 — database guard review follow-up

- Read-only inspected the connected `paxonesflows` Supabase schema and migration history. No SQL was applied to either connected project. The separate `cleanp2p-staging` project currently reports no public tables/migrations through the connector, so it is not yet a usable isolated test database.
- Supabase security advisor currently reports 18 `SECURITY DEFINER` functions executable by `authenticated`, including trade/admin RPCs. These need function-by-function authorization/grant review; the warning alone is not proof of exploitability. It also reports three RLS-enabled service/security tables without policies; confirm service-only grants and access paths.
- Updated local-only migration `20261017170500_trade_chat_message_limits_and_retention.sql`: restricted accounts are now blocked from human trade-chat sends in both guards; added an exception so the same logical message mirrored to the compatibility table does not fail at the 100-message cap. The mirrored-copy allowance requires matching trade, sender, body, and timestamp.
- `git diff --check` passed (only Windows LF/CRLF warnings). Static grep confirmed both restricted-account guards and mirrored-copy handling are present. This is static verification only; PostgreSQL execution/regression testing is still required before migration.
- Working tree remains local/uncommitted on `fix/production-typecheck-batch-1`; no push, merge, deployment, or live database change was made.


## 2026-10-19 — admin identity disclosure hardening

- Read-only review of the live paxonesflows function definition found that public.verify_admin_login(p_user_uuid, user_uuid) trusted a caller-supplied UUID when evaluating admin status. An authenticated user could supply another user's UUID and probe whether that account had admin privileges or was suspended. This is an information-disclosure issue; the UI's intended flow passes the signed-in user's own ID.
- Added local-only migration 20261019110000_harden_verify_admin_login_identity.sql. Non-service callers must be authenticated and any supplied UUID must match auth.uid(); service-role callers retain trusted backend lookup behavior. Anonymous/PUBLIC execution is revoked while the authenticated own-account login check remains available. The migration preserves the live four-column RPC return signature.
- Added tests/verify-admin-login-migration.test.ts static contract checks. Test PASS; npm run typecheck PASS; git diff --check PASS with Windows line-ending warnings only.
- This was not tested by executing the migration against PostgreSQL because the connected cleanp2p-staging project currently has no schema/migration history. The migration is NOT applied to paxonesflows; no live data or permissions were changed.
- Latest local production-only npm audit: 69 findings — 0 critical, 12 high, 57 moderate. High findings remain, mainly Genkit/OpenTelemetry and Tailwind 3 dependency chains. Do not force major upgrades to suppress the audit.
- Next required validation: provision a real isolated Supabase test database with the project's schema/migrations, apply migrations there in order, and test admin login for (1) authenticated self UUID, (2) another user's UUID, (3) anonymous invocation, and (4) service-role lookup. Then review the remaining callable SECURITY DEFINER RPCs individually.

## 2026-10-19 — financial write boundary follow-up

- Tightened local-only migration `20261018110000_restrict_public_financial_write_policies.sql`: anonymous `INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER` privileges are revoked for canonical `ads` and legacy `p2p_ads`; `transfers` write privileges are revoked from `PUBLIC`, `anon`, and `authenticated`, while authenticated sender/recipient history reads and trusted `service_role` inserts remain granted. The direct client-insert RLS policy is removed and the service-role policy is role-scoped.
- Added `tests/financial-write-guard-migration.test.ts`; static migration contract checks **PASS**. `tests/verify-admin-login-migration.test.ts` and `tests/2fa-session-edge.test.ts` **PASS**.
- Final local gates after Next.js 15.5.28 and dependency changes: `npm run typecheck` **PASS**; `npm run lint` **PASS with existing warnings**; `npm run build` **PASS**, with 47 static pages generated and the remaining routes dynamic; `git diff --check` **PASS** with Windows line-ending warnings only.
- Dependency audit is now **69 production findings: 0 critical, 12 high, 57 moderate**. Remaining high findings still block declaring the dependency tree clean.
- Integration/security tests were attempted but cannot be counted as passing: `tests/security-verification.test.ts` reports **2/3**, with the HTTP endpoints unavailable and the concurrency check unable to read a resulting order status; `tests/p2p-trade-flow.test.ts` reports **0/4** because Supabase RPC requests fail to connect in the current local environment. `tests/wallet-provisioning-security.test.ts` has **1/5** passing because `DEPOSIT_HD_MNEMONIC` is not configured; four derivation cases cannot run without a test-only wallet fixture. No secret was added to the repository or logs.
- Read-only Supabase inspection found that `paxonesflows` has live financial tables and a permissive `Users can insert transfers as sender` policy; the new local migration addresses this, but it has NOT been applied. The `cleanp2p-staging` project is empty and cannot currently validate schema migrations.
- No GitHub push/commit/merge/deployment and no live Supabase DDL was performed. Production readiness remains blocked by pending migration execution/validation, integration test environment setup, remaining high/moderate dependency findings, and incomplete external security/load testing.


## 2026-10-19 — internal-transfer account-status guard

- Read-only inspection of the live `execute_internal_transfer` RPC confirmed it is `SECURITY DEFINER` but executable only by `service_role`, and it already checks sender/recipient ban, restriction, emergency-freeze, and `account_status` values. The app route still compared status strings case-sensitively and did not explicitly check `is_suspended` or `is_minor_restricted`.
- Updated `src/app/api/wallet/transfer/route.ts` to fetch the relevant sender/recipient status flags and use a shared `src/lib/transfer-account-status.ts` guard. The guard normalizes status values, blocks any explicit non-`ACTIVE` account status, and denies banned, restricted, suspended, minor-restricted, emergency-frozen, deletion-pending, deleted, closed, and inactive accounts for both sender and recipient. Existing user-facing text was not changed.
- Added `tests/transfer-account-status.test.ts`; cases for active casing, banned/deletion-pending statuses, restriction flags, and frozen accounts pass. Also reran static financial-write migration checks, admin-login migration contract checks, and the 2FA Edge regression test; all pass.
- Re-ran local production quality gates after the route change: typecheck, 2FA test, lint, Next.js build, and `git diff --check` completed successfully. ESLint warnings remain (including object-injection and unsafe-regex warnings); they were not suppressed. Final post-extraction gate log: `local-audit-logs/final-gate-after-transfer-guard-20261019.log` (typecheck, four targeted tests, lint, build, and diff check all passed).
- Production-only `npm audit` remains at 69 findings (0 critical, 12 high, 57 moderate). Read-only Supabase advisors still show 18 authenticated-callable `SECURITY DEFINER` functions requiring function-by-function review, three RLS-enabled tables with no policies, five unindexed foreign keys (a local migration is prepared), and numerous RLS performance/policy warnings. These are triage items, not blanket proof of exploitability.
- No database migration was applied; `cleanp2p-staging` still has no schema and cannot validate these SQL migrations. No GitHub push/commit/merge/deployment was performed. Paxones remains **not production-ready** until SQL is tested in a full isolated database, financial integration/concurrency tests run against valid test credentials, remaining high dependency findings are resolved or accepted with documented risk, and external security/load testing is completed.

## 2026-10-19 � Database security and integration-test checkpoint

- Read-only project discovery: `cleanp2p-staging` (`tazvjyrdondcrdrkggqe`) currently exposes no public tables and no migration history through the Supabase connector, so it is not yet a usable isolated schema for testing these app migrations. The populated project `paxonesflows` (`eaiwgfxoiwxepinvcykg`) has the app schema and migration history through `20261016013425`; treat it as live/production-sensitive and do not apply local migrations without explicit approval.
- Supabase security advisor on `paxonesflows`: 3 RLS-enabled 2FA/security tables have no policies (likely fail-closed; verify table grants), and 18 SECURITY DEFINER functions are executable by `authenticated`. The advisor is a review queue, not proof all 18 are exploitable. High-priority functions reviewed include `verify_admin_login` (current DB version accepts a caller-supplied UUID without binding it to `auth.uid()`), `initiate_didit_kyc` (function body checks self identity but still has unnecessary direct client execute), and escrow/admin RPCs that need per-function authorization review.
- Supabase performance advisor reported 5 unindexed foreign keys, addressed in the prepared local migration `20261019100000_add_financial_fk_indexes.sql`; it also reports duplicate indexes and multiple permissive policies, which need separate safe review before cleanup.
- Prepared locally (not applied): `20261018100000_restrict_didit_kyc_rpc_execution.sql`, `20261018110000_restrict_public_financial_write_policies.sql`, `20261019100000_add_financial_fk_indexes.sql`, and `20261019110000_harden_verify_admin_login_identity.sql`.
- Passed local static tests: `tests/financial-write-guard-migration.test.ts`, `tests/verify-admin-login-migration.test.ts`, `tests/transfer-account-status.test.ts`, and `tests/2fa-session-edge.test.ts`; `git diff --check` passed (only Windows LF/CRLF notices).
- `npm run test:all` did NOT pass: the P2P escrow integration suite reported `TypeError: fetch failed` for its Supabase RPC calls and ended at 0/4. This is a blocked integration verification, not a product-level assertion that all escrow behavior is broken. Do not claim escrow/financial integration tests passed until the test endpoint/config/network is corrected and the suite is rerun.
- No live database changes, commits, pushes, merges, or deployments were made. Next: confirm which project should be used for isolated SQL tests, establish a reachable disposable DB, run migrations there in order, then test the high-risk RPC authorization and transfer-write protections before considering production rollout.


## 2026-10-19 — Supabase live security review (read-only)

- Inspected connected projects. `cleanp2p-staging` currently reports no public tables and no migration history through the Supabase connector, so it is not a usable validation target in its current state.
- Reviewed the active `paxonesflows` project's Supabase security/performance advisors. Security advisor reports 18 `SECURITY DEFINER` functions executable by authenticated users (each requires authorization/grant review; this warning alone does not prove exploitation). Performance advisor reports 74 multiple-permissive-policy findings, 38 auth-RLS init-plan findings, 5 unindexed foreign keys, and 5 duplicate indexes.
- Read-only catalog inspection confirms broad table privileges are granted to anon/authenticated for financial tables including `transfers`, `trades`, `wallets`, `user_wallets`, `wallet_transactions`, `user_balances`, and `withdrawals`; RLS currently provides the main restriction. This is not by itself proof of bypass, but grants should be least-privilege and RLS/trigger/RPC behavior must be regression-tested.
- `transfers` has an authenticated insert policy that only checks `auth.uid() = sender_id`; the row contains amount, recipient, asset, and status fields. A direct insert may create a forged history record even if it does not move balances, so direct client inserts should be denied and transfers created only by the atomic transfer RPC/service path. Need verify API callers before finalizing the remediation migration.
- `execute_internal_transfer` and `execute_wallet_transfer` are not executable by anon/authenticated in current grants, which is the desired posture for these sensitive SECURITY DEFINER functions.
- Offline-ad migration review found the trade trigger resolves ad ownership only from `public.ads`; verify legacy `p2p_ads` references before considering it valid. Do not apply this migration until corrected and tested.
- No live schema, data, grants, migrations, or policies were changed. No financial operations were performed. Next work: inspect transfer API/RPC call paths, prepare a least-privilege local migration, test its assumptions, then independently review all exposed SECURITY DEFINER functions.


## 2026-10-19 — Security-definer grant review and financial-index regression checks

- Read-only production inspection confirmed the live verify_admin_login(uuid, uuid) SECURITY DEFINER function currently chooses COALESCE(p_user_uuid, user_uuid, auth.uid()) without requiring a non-service caller's target UUID to equal auth.uid(). Its ACL permits authenticated execution. This is a real identity/role-probing risk; local migration 20261019110000_harden_verify_admin_login_identity.sql now enforces caller identity and reserves arbitrary-target inspection for service_role. The migration is NOT applied.
- Read-only production inspection also confirmed initiate_didit_kyc(uuid, text) is currently executable by authenticated, accepts a caller-supplied user ID/session ID, and has no matching application caller in the local source tree. Local migration 20261018100000_restrict_didit_kyc_rpc_execution.sql revokes client execution and sets an empty search_path. This migration is NOT applied; verify any out-of-repository integration before deployment.
- Added static regression tests tests/restrict-didit-kyc-migration.test.ts and tests/financial-fk-indexes-migration.test.ts for those grant expectations and the five FK indexes identified by Supabase's performance advisor.
- Verification: Didit migration test PASS; FK-index migration test PASS; admin-login migration contract test PASS; financial-write guard migration test PASS; git diff --check PASS with Windows LF/CRLF warnings. These tests assert migration text only; they do not execute SQL or prove deployed grants.
- Read-only Supabase Security Advisor reports 18 authenticated-callable SECURITY DEFINER functions requiring individual authorization review, three RLS-enabled 2FA/security tables without policies, and performance findings including five unindexed foreign keys, five duplicate-index pairs, 38 auth-RLS init-plan warnings, and multiple permissive policies. Do not mass-revoke grants, drop indexes, or rewrite policies without checking callers and data-access requirements.
- No production/staging SQL was changed, no migrations were applied, and no commit/push/deployment occurred. The available cleanp2p-staging project still has no migration history and is not a valid baseline for safely testing these migrations.


## 2026-10-19 — Financial integration-test fail-closed guard

- Fixed a test-safety problem discovered when running `npm run test:all`: the financial integration suites previously fell back to `https://placeholder.supabase.co` and a placeholder/anon key, still attempted RPCs, and could print failed test counts while exiting with code 0. Those tests seed or mutate wallet, trade, deposit, and withdrawal records, so an explicit disposable database is mandatory.
- Added `tests/helpers/test-supabase.ts`; the P2P escrow, blockchain/deposit/withdrawal, reconciliation, and security/chaos suites now require `PAXONES_TEST_SUPABASE_URL`, `PAXONES_TEST_SUPABASE_SERVICE_ROLE_KEY`, and `PAXONES_TEST_DB_ALLOW_MUTATIONS=1`, and refuse the known `paxonesflows` production project. Test suites now set `process.exitCode = 1` on assertion failures or uncaught errors; the security/chaos suite no longer counts a failed concurrency request as a passed test.
- This is a local test-harness safety change, not a financial product fix. The current `cleanp2p-staging` project has no tables or migration history, so the live integration suites must remain blocked until a disposable schema is provisioned and populated safely.
- Production Supabase security review remains read-only. Live `verify_admin_login` still has the caller-supplied UUID identity-binding issue addressed by the local-only migration `20261019110000_harden_verify_admin_login_identity.sql`; the migration has not been applied. Security advisor warnings and the 69 production dependency findings (12 high, 57 moderate) remain open.
- No live Supabase changes, real financial operations, GitHub commits/pushes, or deployments were performed.


## 2026-10-19 — transfer table least-privilege follow-up

- Tightened local-only migration `20261018110000_restrict_public_financial_write_policies.sql`: in addition to denying direct transfer writes to `PUBLIC`, `anon`, and `authenticated`, it now revokes `SELECT` on `transfers` from `PUBLIC` and `anon`; only authenticated participants retain history reads, and `service_role` retains trusted access. This is defense-in-depth alongside RLS, not proof the migration has been applied.
- Expanded `tests/financial-write-guard-migration.test.ts` to assert the new SELECT revoke and explicit authenticated write revokes.
- Live read-only inspection of `paxonesflows` confirmed `transfers` currently has an INSERT policy assigned to `PUBLIC` with only `auth.uid() = sender_id`, and table grants include broad anon/authenticated privileges. The local migration is intended to remove this forged-history surface, but it remains unapplied pending a real isolated database and explicit rollout approval.
- No live Supabase DDL/data changes, financial operations, commits, pushes, or deployment occurred.


## 2026-10-19 — offline-ad seller-owner resolution hardening

- Continued the read-only Supabase review of `paxonesflows`. The live schema confirms `public.ads.id` is text while legacy `public.p2p_ads.id` is UUID, and trades may carry `ad_id` as text. The prepared offline-ad guard previously resolved the owner only through canonical `public.ads`; a legacy-only ad could therefore fail with `AD_OWNER_UNAVAILABLE` even when its owner profile existed.
- Updated local-only migration `20261017170800_deactivate_ads_after_offline_attempts.sql` so `guard_trade_seller_online()` resolves the owner from canonical `public.ads` first and then falls back to `public.p2p_ads` using legacy ID/public ID. It still fails closed if neither table resolves an owner and rejects stale presence.
- Added `tests/offline-ad-owner-resolution-migration.test.ts` to assert canonical-first resolution, legacy fallback, fail-closed behavior, and the 120-second heartbeat threshold.
- Verification PASS: offline-ad migration contract test; financial-write migration contract test; admin-login migration contract test; transfer account-status unit test; `git diff --check` (only existing Windows LF/CRLF notices).
- This is static verification only. No PostgreSQL engine test was possible: `cleanp2p-staging` has no schema/migration history, while `paxonesflows` is treated as production-sensitive. No live SQL, commits, pushes, merges, deployments, or financial operations were performed.
- Remaining blockers include validating the SQL migrations in a populated disposable database, verifying canonical/legacy ad mirroring and trigger ordering with database-level regression tests, reviewing all 18 authenticated-callable `SECURITY DEFINER` functions, and resolving/accepting the remaining 69 production dependency audit findings (12 high, 57 moderate).


## 2026-10-19 follow-up: trade RPC admin-metadata hardening

- Read-only inspection of live `paxonesflows` function definitions found user-editable `auth.users.raw_user_meta_data` role checks in five RPCs: `mark_p2p_trade_paid`, `raise_trade_dispute`, `resolve_trade_dispute`, `expire_p2p_trade`, and `cancel_expired_p2p_trades`. User-editable Auth metadata must not authorize financial, dispute, or privileged trade operations. The last three are currently service-role-only, but should not rely on user metadata either.
- Added local migration `20261019130000_remove_user_metadata_admin_trust_from_trade_rpcs.sql`. It retrieves the exact currently installed function definitions with `pg_get_functiondef`, removes only the unsafe role predicate across the observed formatting variants, preserves other function logic and ACLs, and fails closed if it cannot match the expected expression. It does not revoke the authenticated RPC access needed by participant flows.
- Added static contract test `tests/trade-rpc-admin-metadata-migration.test.ts`.
- Passed: the new migration contract test, existing admin-login migration contract test, escrow search-path migration contract test, `npm run typecheck`, and `git diff --check` (only Windows LF/CRLF warnings).
- Not yet done: no isolated PostgreSQL engine test, no runtime impersonation test, no live migration. The production database remains unchanged. Before deployment, run the migration in a disposable schema and verify that forged user metadata cannot authorize either action while legitimate participant actions still work.


## 2026-10-19 — trade-chat direct-write authorization review

- Read-only catalog inspection of the populated `paxonesflows` project found **no non-internal triggers** attached to `public.trade_messages` or `public.trade_chat_messages` in the live database. The live `trade_chat_messages` INSERT policy checks only that `sender_id = auth.uid()`; it does not itself verify that the caller participates in the target trade. Authenticated users currently have table INSERT grants, so this is a concrete direct-RPC/table authorization gap unless another external layer prevents those writes.
- The prepared local-only migration `20261017170500_trade_chat_message_limits_and_retention.sql` adds database trigger guards to both chat tables, including sender identity, participant membership, restricted-account checks, closed-trade checks, and a serialized per-table cap of 100 human-message rows. Review found that deduplicating cross-table messages by sender/body/client-supplied timestamp could be forged, so the migration now counts rows in the table receiving the insert rather than trusting that deduplication key. A strict 100-message global cap across both legacy tables remains pending until writes use a shared server-trusted logical message ID or one table is made authoritative. The live migration history does not include this migration; **the fix is not deployed**.
- Added `tests/trade-chat-guards-migration.test.ts` to assert that both trigger attachments and core safety conditions remain in the migration. The test passed. The related trade-RPC metadata, admin-login, financial-write, offline-ad owner, transfer-status, and 2FA Edge contract/unit tests also passed; `git diff --check` passed with only existing Windows line-ending notices.
- Confirmed the three RLS-enabled 2FA/security tables flagged by the advisor grant no table privileges to `anon` or `authenticated`; `service_role` is the only API role with table grants in the inspected catalog. The no-policy warnings therefore appear intentionally fail-closed, though service-side access still needs runtime regression coverage.
- No live SQL, data, grants, policies, or triggers were changed. No commit, push, merge, or deployment occurred. Keep the chat guard migration pending until it runs against a populated disposable schema and tests verify a nonparticipant cannot write to either chat table.


## 2026-10-19 — Trade participant account-status guard (local only)

- Added `supabase/migrations/20261019080000_guard_trade_participant_account_status.sql` as defense in depth. Read-only inspection of the connected `paxonesflows` database confirmed `initiate_trade_with_escrow` already checks both the authenticated caller and ad owner for banned/restricted/suspended/minor-restricted/non-active status. However, the live `trades` table had no corresponding participant-status INSERT trigger, leaving direct/alternate insertion paths to be reviewed.
- The new BEFORE INSERT trigger verifies both participant profiles exist, rejects self-trades, and fails closed unless both profiles are active and not banned, restricted, suspended, or minor-restricted. It applies to service-role inserts too, preventing privileged route mistakes from bypassing participant restrictions.
- Read-only schema verification confirmed `trades.buyer_id` and `trades.seller_id` are text, `profiles.id` is UUID, and the expected status columns exist. Scope is limited to new trade rows; it does not block settlement/cancellation updates for existing trades.
- **Not applied to Supabase.** Local environment has no `psql`, Supabase CLI, or Docker, so SQL engine execution and trigger regression tests remain outstanding. The separate staging Supabase project currently reports no tables/migrations, so it cannot validate this trigger until a known-good baseline schema is provisioned.
- This migration is a candidate defense-in-depth fix, not a verified production fix. Before deployment, validate trigger ordering, RPC behavior, legitimate administrative flows, and rollback on an isolated PostgreSQL/Supabase database.

- Added `tests/trade-participant-account-status-migration.test.ts`; it passed alongside `tests/trade-chat-guards-migration.test.ts`. `git diff --check` also passed (only existing Windows LF-to-CRLF notices). These are static contract tests only, not SQL-engine or authorization integration tests.
- Live read-only inspection confirmed `trade_chat_messages` has an INSERT RLS policy checking only `sender_id = auth.uid()`, while authenticated users have INSERT privilege. This does not prove a nonparticipant can complete an exploit end-to-end, but the policy itself lacks the participant-membership check; the prepared local chat trigger remains a high-priority pending fix.
- No live SQL was changed; no commit, push, merge, or deployment occurred.

- Dependency audit rerun on 2026-10-19: `npm audit --omit=dev` reports 69 findings (57 moderate, 12 high, 0 critical); full-tree `npm audit` reports 72 (58 moderate, 14 high, 0 critical). High findings include Genkit/OpenTelemetry dependency chains and Tailwind 3.4.x transitive packages; npm suggests major upgrades for some items, so no force-upgrade was applied. The previous 75/1-critical count is stale for the current dependency tree.


## 2026-10-19 — idempotency replay account-status guard (local only)

- Read-only inspection of the installed `public.initiate_trade_with_escrow` definition confirmed the account eligibility guard occurs after the early idempotency lookup. A participant whose account is later disabled could therefore receive a successful replay response for an old trade, even though new trade creation is blocked later in the RPC.
- Added local-only migration `20261019140000_block_disabled_account_idempotency_replay.sql`. It obtains the installed RPC body with `pg_get_functiondef` and inserts a fail-closed check before the idempotency lookup. It preserves the currently installed function body, search-path configuration, and ACLs rather than replacing the RPC with an older source snapshot. It refuses to proceed if the function signature or unique insertion marker differs, and is idempotent if the early guard is already present.
- Added `tests/trade-idempotency-account-guard-migration.test.ts`; static migration-contract test passed. Read-only live catalog query confirmed the expected insertion marker exists exactly once and the new guard is not already present before that marker.
- Quality gate on 2026-10-19: `npm run typecheck` passed; `npx tsx tests/2fa-session-edge.test.ts` passed; `npm run lint` completed with warnings (notably object-injection lint warnings, unsafe-regex warnings, React hook dependency warnings, and the deprecated `next lint` command); `npm run build` passed on Next.js 15.5.28; `git diff --check` passed with only Windows LF/CRLF notices.
- No PostgreSQL CLI, Supabase CLI, Docker, or `pg_format` is installed locally. The new SQL migration has **not** been executed against a PostgreSQL engine and is **not deployed**. Static checks do not prove migration syntax, function compilation, or runtime authorization behavior.
- No live Supabase DDL/data changes, financial operations, commits, pushes, merges, or deployment occurred. Continue to treat the local migration as pending until it passes against a populated disposable database and tests cover active, banned, restricted, suspended, minor-restricted, missing-profile, and legitimate idempotent-retry cases.


## 2026-10-19 — reviewed SECURITY DEFINER search-path hardening (local only)

- Read the live `paxonesflows` function definitions and confirmed the following six SECURITY DEFINER RPCs use `search_path=public, pg_temp`: `cancel_p2p_trade`, `get_emergency_mode`, `get_user_2fa_status`, `initiate_didit_kyc`, `mark_p2p_trade_paid`, and `raise_trade_dispute`. Their table and auth-helper references were reviewed as schema-qualified.
- Added `supabase/migrations/20261019150000_harden_security_definer_search_paths.sql` to set an empty search path for those six functions. It changes no function bodies, grants, or financial logic.
- Added `tests/security-definer-search-paths-migration.test.ts`. The static contract test passed after correcting the test matcher.
- Re-ran all migration contract tests: 10 existing migration tests passed; the new search-path test passed separately. `npm run typecheck` passed before the test matcher-only correction; rerun the full gate after this addition. `git diff --check` passed with Windows LF/CRLF warnings only.
- Fresh production-only dependency audit (`npm audit --omit=dev`) reports **69 findings: 57 moderate, 12 high, 0 critical**. No force-upgrades were performed; several findings have no non-major fix available.
- Supabase security advisor still lists 18 SECURITY DEFINER functions executable by `authenticated`; this is an audit queue, not proof every function is exploitable. The new migration only hardens search paths for six reviewed functions; it does not remove their authenticated EXECUTE grants.
- Staging project remains empty (no public tables/routines/migrations). SQL engine execution and financial authorization/concurrency testing remain blocked.
- **Not deployed:** no live SQL writes, migrations, data changes, financial actions, commits, pushes, merges, or deployments.


## Production-readiness batch — chat-retention migration static correction (2026-10-19)

- Reviewed `supabase/migrations/20261017170500_trade_chat_message_limits_and_retention.sql` against the repository's base chat/trade schema.
- Fixed the UUID/text sender comparison in the `trade_messages` trigger (`NEW.sender_id::text`), and changed participant comparisons to use UUID values rather than comparing UUID columns to text.
- Removed writes to `NEW.is_moderator` and `NEW.sender_username` from the `trade_messages` trigger because the repository's base `trade_messages` table does not define those fields.
- Corrected the chat allowance to **100 human messages per participant per trade**, rather than 100 total messages per trade; advisory locks are scoped per trade and sender.
- Removed the `trades.expired_at` dependency because it is not defined by the checked-in migrations. Made the legacy `trade_chat_messages` trigger and purge conditional because the checked-in migration history does not create that table.
- Static assertions: all 7 targeted checks PASS. `git diff --check`: PASS (only Windows LF/CRLF warnings).
- **Not database-validated:** local machine has no `psql`, Supabase CLI, or Docker. The connected `cleanp2p-staging` Supabase project currently reports zero public tables and zero recorded migrations, so it is not an initialized schema suitable for testing these changes. No migration was applied to either Supabase project.
- Remaining blockers: validate all prepared migrations against an initialized isolated schema and run SQL behavior tests for chat caps/retention, ad caps, offline-attempt pausing, account deletion queue, and canonical escrow account-status guards before any production rollout.


## 2026-10-19 — Live database security checkpoint
- Read-only Supabase catalog/advisor review completed for `paxonesflows`; no production SQL or financial changes were made.
- Confirmed live `public.transfers` grants include anon SELECT/INSERT and authenticated INSERT/UPDATE, alongside broad PUBLIC policies; high-priority financial integrity blocker.
- Confirmed anon INSERT grants exist on `public.ads` and `public.p2p_ads`; local migration `20261018110000_restrict_public_financial_write_policies.sql` prepares the defense-in-depth lockdown but is not applied.
- Reviewed 18 SECURITY DEFINER advisor findings; caller checks exist in several trade/KYC/2FA RPCs, but trade lifecycle RPCs still use user-editable Auth metadata as an admin signal in live definitions.
- SELECT-only regex simulation verified local migration `20261019130000_remove_user_metadata_admin_trust_from_trade_rpcs.sql` matches all five reviewed functions and removes remaining `raw_user_meta_data` references from those definitions.
- Added `docs/PRODUCTION-SECURITY-CHECKPOINT-20261019.md` with findings, boundaries, and release blockers.
- `cleanp2p-staging` is currently empty (no recorded migrations/public tables); local PostgreSQL and Supabase CLI were not found, so engine replay remains outstanding.
- Release status remains NOT READY. Do not apply migrations until isolated-database replay and negative/positive financial RPC tests pass.


## 2026-10-19 — canonical public-ad visibility hardening

- Read-only live Supabase review found `public.ads` policy `Allow public read access for ads` uses `USING (true)`, unlike the active/non-deleted guard on `public.p2p_ads`.
- Prepared local-only migration `supabase/migrations/20261019160000_restrict_public_ad_reads.sql`: public users can read only active, non-deleted ads; authenticated owners retain read access to their own non-deleted ads, including paused/draft ads.
- Added `tests/public-ad-read-policy-migration.test.ts`; PASS. Also reran six adjacent KYC/admin-identity/trade-RPC/search-path/idempotency migration contract tests; all PASS.
- `git diff --check` passed with Windows line-ending warnings during the first run. The latest `npm run typecheck` was started after the changes but its completion output was not returned by Desktop Commander; previous full quality gate had passed typecheck.
- Isolated SQL validation remains blocked: local workstation has no `psql`, `postgres`, Docker, or Supabase CLI; `cleanp2p-staging` has no tables/migration history. No live database change, commit, push, merge, deployment, or financial operation was performed.
- Release remains **NOT PRODUCTION READY**. Before deploying this policy, validate it against a schema-matched disposable database and verify the admin ads dashboard can still review paused/deleted ads through its intended trusted path.


## Production-readiness step — 2026-10-19: active-ad limit correction
- Corrected the prepared local-only `20261017170600_enforce_user_active_ad_limit.sql` from 20 to **10 active advertisements per user**, matching the product requirement. The rule still counts logical ads across both `public.ads` and legacy `public.p2p_ads`, and serializes account activation checks.
- Added `tests/active-ad-limit-migration.test.ts` to assert the 10-ad limit, both ad stores, trigger coverage, and disabled-account checks.
- Validation: targeted migration contract test PASS (1/1); `npm run typecheck` PASS; `git diff --check` PASS (only existing Windows LF/CRLF warnings).
- Read-only Supabase metadata inspection confirmed the live schema contains the columns referenced by the active-ad/offline-ad migration paths (`ads`, `p2p_ads`, `profiles`, `trades`, chat tables, and notifications). This checks column compatibility only; it does **not** execute SQL or prove runtime behavior.
- Full static migration/security suite: 14/14 passed before this change; active-ad test adds one more test. Production dependency audit remains blocked at 69 findings (57 moderate, 12 high) in the latest audit output, including a UUID advisory reported with no fix available in the current graph.
- Safety: no production SQL writes, migrations, commits, pushes, merges, deployments, or financial operations were performed. The local changes remain uncommitted. App remains **NOT production-ready** until the SQL migrations run successfully in a schema-matched isolated database, runtime authorization/financial regression tests pass, and dependency vulnerabilities are remediated or formally assessed.


## 2026-10-19 — trade RPC trusted-caller fallback hardening (local only)

- Read-only catalog inspection of `paxonesflows` found the installed SECURITY DEFINER trade RPCs `initiate_trade_with_escrow`, `mark_p2p_trade_paid`, `cancel_p2p_trade`, and `raise_trade_dispute` accept a caller-supplied ID in the `auth.uid() IS NULL` fallback path. Each is executable by `authenticated`; anonymous EXECUTE was not granted. This should fail closed unless the database role is explicitly `service_role`.
- Added local-only migration `supabase/migrations/20261019100100_restrict_trusted_caller_id_fallback_to_service_role.sql`. It retrieves the installed function definitions with `pg_get_functiondef`, checks the expected fallback occurs exactly once, and inserts a service-role-only guard without replacing the rest of the function bodies or ACLs. It aborts if function signatures or expected source shape drift.
- Added `tests/trusted-caller-fallback-migration.test.ts`; 2/2 static contract tests passed. `git diff --check` passed with only existing Windows LF/CRLF warnings.
- This is **not engine-validated or deployed**. The connected `cleanp2p-staging` project is empty and has no matching schema; local PostgreSQL, Docker, and Supabase CLI are unavailable. The migration has not been run against either Supabase project.
- No live SQL writes, commits, pushes, merges, deployments, or financial operations occurred. Production remains **NOT READY** until this migration passes against a schema-matched disposable database and positive/negative RPC authorization tests pass.


## 2026-10-19 — trade RPC account and price hardening (local only)
- Hardened `public.initiate_trade_with_escrow` in `20260928070000_canonical_p2p_state_machine_and_rpcs.sql`: the RPC now rejects banned, restricted, suspended, deletion-pending, or deleted accounts for both the initiating caller and ad owner before wallet creation or escrow mutation.
- Removed the caller-supplied `p_price` as the authoritative trade price for both canonical `p2p_ads` and legacy `ads`; the selected database ad row now supplies the price. Invalid/non-positive stored prices fail closed instead of silently substituting `1.0`.
- Hardened `20261017170600_enforce_user_active_ad_limit.sql`: changing `public_ad_id` now re-runs the limit guard for both ad tables, and public-ID duplicate checks also cover updates while excluding the row being updated.
- Added static regression coverage in `tests/trade-rpc-account-price-guards.test.ts` and expanded `tests/active-ad-limit-migration.test.ts`. Targeted tests: **3/3 PASS**; `npm run typecheck`: **PASS**; `git diff --check`: **PASS** (Windows LF/CRLF warnings only).
- These are source-level/static checks only. The workstation has no `psql` or Supabase CLI, and `cleanp2p-staging` has no initialized public schema/migration history. The live `paxonesflows` project was inspected read-only; no migrations or SQL writes were applied.
- No commit, push, merge, deployment, or financial operation was performed. Production remains **NOT READY** until migrations replay cleanly on an initialized schema-matched disposable database, and positive/negative financial RPC tests pass. Price-policy compatibility for dynamic-margin ads must be verified before rollout.


## 2026-10-19 — internal-transfer RPC response integrity

- Added `src/lib/transfer-rpc-validation.ts` to reject successful RPC payloads unless sender, recipient, asset, requested amount, net amount, fee, total deduction, status, and optional balance fields are internally consistent and finite.
- Wired the validation into `src/app/api/wallet/transfer/route.ts`. The route now fails closed if the trusted RPC's returned receipt does not match the authenticated sender, resolved recipient, requested asset, and requested amount. It also rejects non-finite input amounts before calling the RPC.
- Added `tests/transfer-rpc-validation.test.ts` covering a valid response, identity/asset/amount mismatches, non-finite and negative values, inconsistent totals, and malformed payloads.
- Verification: targeted tests **5/5 PASS** (including the financial-write migration contract test); `npm run typecheck` **PASS**; `git diff --check` **PASS** (only existing Windows LF/CRLF warnings).
- Important operational nuance: the database RPC is atomic and may have committed before an invalid response is detected. The API tells the caller to contact support before retrying; the idempotency key remains the protection against duplicate execution. This is response-integrity hardening, not a substitute for database/ledger reconciliation.
- No live SQL writes, migration, commit, push, merge, deployment, or real financial operation occurred. This change is local and uncommitted. The app remains **NOT PRODUCTION READY** because transfer-table grants remain too broad in the live project until the prepared migration is validated and approved, and schema-matched SQL/financial regression tests are still outstanding.


## 2026-10-19 — offline-ad canonical ID compatibility correction

- Read-only live catalog inspection confirmed `public.ads` has both `public_ad_id` and `public_id`, while the legacy `public.p2p_ads` schema uses `public_ad_id`.
- Corrected the local-only offline-ad attempt migration so canonical `public.ads` attempt counters reset/update and ads pause matching both `public_ad_id` and `public_id`. Without this, a mirrored canonical ad identified by `public_id` could fail to receive the pause/reset when the attempt was initiated against its legacy counterpart.
- Targeted tests passed: `offline-ad-owner-resolution-migration.test.ts`, `active-ad-limit-migration.test.ts`, and `trade-rpc-account-price-guards.test.ts` (2 trade-RPC assertions passed). Additional PowerShell static assertions passed for canonical ID matching, 3-attempt threshold, idempotency uniqueness, pinned SECURITY DEFINER search paths, and SQL delimiters. `git diff --check` passed with existing Windows line-ending warnings.
- These are static/source checks only. The prepared migration has not been run by PostgreSQL. The staging project is still empty; the populated `paxonesflows` project was inspected read-only. No live migration, commit, push, merge, deployment, or financial action occurred.


## 2026-10-19 — Profile access privilege validation
- Confirmed read-only against `paxonesflows`: neither `anon` nor `authenticated` has table-level SELECT privilege on `public.profiles`; a permissive SELECT RLS policy does not grant that privilege. No `public_profiles` view was found in the public schema.
- Local source inventory found 144 files/paths containing profile table access patterns (includes server/service-role usage; browser-only subset still needs classification). Do not solve by granting broad table SELECT because `profiles` contains sensitive fields.
- Ran all discovered `*migration.test.ts` contract tests: PASS; `npm run typecheck`: PASS; `git diff --check`: PASS (only Windows LF/CRLF warnings).
- `cleanp2p-staging` has no public tables/migration history and is not a schema-matched test DB. `paxonesflows` live migration history ends 2026-10-16; newer local migrations remain unapplied.
- Detailed evidence and safe remediation sequence: `docs/PRODUCTION-STEP-20261019-PROFILE-ACCESS-VALIDATION.md`.
- No live database changes, commits, pushes, merges, or deployments were made. Status remains NOT PRODUCTION READY.


## 2026-10-20 — canonical active-trade limit (local only)

- Reviewed the trade creation entry points: `/api/trades/initiate`, `/api/trades/create`, `/api/p2p/trade/initiate`, and `/api/p2p/orders/create` all call the canonical `initiate_trade_with_escrow` RPC; a GET limit alone would not enforce a creation cap.
- Added `supabase/migrations/20261020100000_enforce_user_active_trade_limit.sql`. Its `BEFORE INSERT` trigger on canonical `public.trades` enforces at most **20 simultaneous non-terminal trades per participant**, for buyer and seller. It locks participant profile rows in sorted UUID order before counting, so concurrent inserts for the same user serialize; completed/cancelled/expired/resolved/refunded trade history is not intended to be a lifetime cap.
- Added `tests/active-trade-limit-migration.test.ts` for source-contract assertions.
- Verification: active-trade migration contract **PASS**; trade-media quota migration contract **PASS**; trade-chat guard migration contract **PASS**; `npm run typecheck` **PASS**; `git diff --check` **PASS** (only Windows LF/CRLF warnings).
- Important limitation: this is static/source validation only. No initialized schema-matched PostgreSQL database is available for trigger creation, concurrency tests, terminal-status compatibility checks, or end-to-end escrow rollback tests. The migration has **not** been applied to `paxonesflows` or any other database.
- No commit, push, merge, or deployment occurred. Production remains **NOT READY** until isolated database replay and concurrent participant-cap tests pass, alongside remaining security, financial, dependency, and build gates.


## 2026-10-20 — moderator-only attachment display privacy (local only)

- Found a specific disclosure path: the trade chat's Realtime INSERT handler added every `trade_messages` row directly to the UI without applying the moderator-only visibility filter. Initial direct table reads also mapped all returned rows into chat state.
- Updated `src/components/trade/trade-chat.tsx` so both initial reads and Realtime INSERTs hide `moderator_only` messages from the other trader while allowing the sender and moderator/admin to see them.
- Added `tests/moderator-only-media-privacy.test.ts`. Static test **PASS** for the initial chat filter, Realtime filter, media proxy restriction, and trade-detail API restriction.
- Security limitation: client filtering is defense-in-depth only. It does not stop a malicious participant from querying Supabase directly if table grants/RLS/realtime policies allow restricted rows. Database RLS and Realtime access must be verified with separate buyer, seller, and moderator sessions on an initialized schema-matched database; that test environment is still unavailable.
- No live DB changes, commit, push, merge, or deployment occurred. Production remains **NOT READY**.


## 2026-10-20 — 100-message chat-limit support escalation (local only)

- Added `src/app/api/trades/[tradeId]/chat-limit-support/route.ts`. It requires a valid signed-in user, verifies buyer/seller participation using the server-side admin client, and creates a moderator-visible row in the existing `support_tickets` queue with the trade ID, authenticated user ID, and support contact.
- Added `supabase/migrations/20261020110000_trade_chat_limit_support_requests.sql` for a private service-role-only idempotency table with a unique `(trade_id, user_id)` constraint. This prevents duplicate tickets after the request is successfully linked.
- Updated the trade chat limit handler to call the new route when the database returns `TRADE_CHAT_LIMIT_REACHED`; the chat send remains blocked and the user is told whether a ticket was recorded or to contact support with the trade ID.
- Added `tests/trade-chat-limit-support.test.ts`. Static source-contract test still needs to be run, along with typecheck and `git diff --check`.
- Important limitations: no actual email is sent by this flow; it creates a ticket in the existing moderator queue. The staging project has no public tables and cannot validate this schema. The new migration is local only and has not been applied to any database. The existing `support_tickets` column contract also needs schema confirmation before this route is deployed.
- No live DB changes, commits, pushes, merges, or deployment occurred. Production remains **NOT READY**.
