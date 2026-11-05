# Paxones Production Readiness Report

Updated: 2026-10-23 (local verification batch)

## Scope and safety

- Repository: `C:\Users\theki\cleanp2p`
- Branch: `fix/production-typecheck-batch-1`
- Worktree: existing changes preserved; 256 status entries reported by `git status --porcelain` at this checkpoint.
- No commit, push, merge, deployment, publish, GitHub Actions run, or database mutation was performed.
- No SQL was written or applied in this batch.
- Production project `paxonesflows` (`eaiwgfxoiwxepinvcykg`) remains read-only. Staging `cleanp2p-staging` (`tazvjyrdondcrdrkggqe`) was not modified or used for database tests.

## Verification results

| Check | Result | Evidence |
|---|---|---|
| TypeScript | PASS | `npx tsc --noEmit`, exit 0 |
| Migration filename/version preflight | PASS | `node scripts/check-migration-versions.mjs`: 134 files scanned, 134 unique valid prefixes |
| Trade RPC admin-metadata migration contract | PASS | `npx tsx tests/trade-rpc-admin-metadata-migration.test.ts`, exit 0 |
| Server/client admin metadata authorization contract | PASS | `npx tsx tests/server-admin-auth-metadata.test.ts`, exit 0 |
| Financial-write guard migration contract | PASS | `npx tsx tests/financial-write-guard-migration.test.ts`, exit 0 |
| Migration version checker unit tests | PASS | `npx tsx tests/check-migration-versions.test.mjs`: 4 passed, 0 failed |
| Git whitespace/conflict-marker check | PASS | `git diff --check`, exit 0; line-ending conversion warnings only |

The three focused static contract tests each printed a PASS result and exited 0. These tests inspect code/migration contracts; they do not substitute for execution against PostgreSQL.

## Changes made in this batch

- No source or SQL files changed during this verification batch.
- Added this report to preserve the verification state.

## Staging and production operations

- Staging project `tazvjyrdondcrdrkggqe`: no database tests run in this batch; no schema/data changes.
- Production project `eaiwgfxoiwxepinvcykg`: no queries or writes performed in this batch. Earlier read-only audit records state that the production migration ledger has 81 records while the local migration chain has 134 files, and that the staging project is empty/uninitialized.
- No production writes, migrations, worker runs, or configuration changes.

## Findings by severity

### Critical — OPEN / NOT PROVEN FIXED IN DATABASE

1. Deposit webhook crediting requires trustworthy on-chain validation of address, amount, network, and confirmations. Current static test batch did not exercise live chain verification or webhook behavior.
2. Production trade RPCs have historically been confirmed to trust user-editable `raw_user_meta_data.role`. The local migration contract test passes, but the migration has not been applied or rehearsed against PostgreSQL; production exposure remains until verified.
3. Migration history is unreconciled: production's 81 ledger versions do not match the local 134-file chain. A passing filename checker validates only local filename uniqueness/format, not replayability or schema parity.

### High — OPEN / NEEDS RUNTIME VALIDATION

- Admin 2FA enrollment/enforcement, allowlist identity verification, financial table grants/RLS, transfer inserts, trade attachment ownership, admin RPC caller identity, withdrawal approval schema, and service-role fail-closed behavior need database-backed negative tests and route-level regression coverage.
- The current worktree is extensively modified and remains uncommitted; all existing changes must be reviewed as a whole before release.
- Empty staging has not provided a schema-matched rehearsal target. Do not apply the migration chain there until a safe, verified baseline/rehearsal approach is established and approved.

### Medium — OPEN / NOT TESTED IN THIS BATCH

- Database-backed rate limits, security headers, health/check-db endpoint privacy, timing-safe internal secret comparison, media upload body-size compatibility, duplicate worker routes, realtime subscription reduction, hidden-tab polling controls, and RLS/index advisor recommendations remain open until separately fixed and tested.
- B2 internals, Didit KYC, 2FA enrollment, online/last-seen, trade chat, wallet/ledger invariants, deposit-address ownership, withdrawal worker claims/idempotency, edge functions, and the remaining API routes are not fully audited.

## Release decision

**BLOCKED.** TypeScript and the local migration/static contract checks pass, but critical financial authorization and deposit controls are not proven by database-backed tests, and migration provenance/schema reconciliation remains unresolved. No percentage-complete claim is made. Production migration and deployment require explicit approval.


## Follow-up batch — 2026-10-23

### Additional focused regression tests

Nine commands executed sequentially; all exited 0:

1. `npx tsx tests/trade-rpc-admin-metadata-migration.test.ts` — PASS
2. `npx tsx tests/server-admin-auth-metadata.test.ts` — PASS
3. `npx tsx tests/verify-admin-login-migration.test.ts` — PASS
4. `npx tsx tests/trusted-caller-fallback-migration.test.ts` — PASS; 2 subtests passed, 0 failed
5. `npx tsx tests/security-definer-search-paths-migration.test.ts` — PASS
6. `npx tsx tests/financial-write-guard-migration.test.ts` — PASS
7. `npx tsx tests/withdrawal-idempotency-migration.test.ts` — PASS
8. `npx tsx tests/trade-escrow-search-path-migration.test.ts` — PASS
9. `npx tsx tests/trade-rpc-account-price-guards.test.ts` — PASS; 2 subtests passed, 0 failed

Focused batch total: 9 commands passed, 0 failed. These are source/migration contract tests; none executes SQL against PostgreSQL.

### Environment limitation confirmed

Checked command availability on the authorized Windows workstation: `psql`, `supabase`, and `docker` are not found on PATH. This batch therefore cannot perform a local PostgreSQL migration replay using the currently available CLI tools. No software was installed and neither database was modified.

### Decision

No migration was applied. The next meaningful gate is to establish a disposable, schema-matched PostgreSQL rehearsal path and test the trade RPC migration against actual function definitions, grants, and admin/non-admin behavior. Static contract tests are not proof of runtime authorization safety.


## Follow-up batch 2 — 2026-10-23

### Additional regression suite

Executed 11 commands; all exited 0:

1. `npx tsx tests/active-ad-limit-migration.test.ts` — PASS
2. `npx tsx tests/active-trade-limit-migration.test.ts` — PASS
3. `npx tsx tests/financial-fk-indexes-migration.test.ts` — PASS
4. `npx tsx tests/offline-ad-owner-resolution-migration.test.ts` — PASS
5. `npx tsx tests/public-ad-read-policy-migration.test.ts` — PASS
6. `npx tsx tests/restrict-didit-kyc-migration.test.ts` — PASS
7. `npx tsx tests/trade-chat-guards-migration.test.ts` — PASS
8. `npx tsx tests/trade-idempotency-account-guard-migration.test.ts` — PASS
9. `npx tsx tests/trade-media-quota-migration.test.ts` — PASS
10. `npx tsx tests/trade-participant-account-status-migration.test.ts` — PASS
11. `npx tsx tests/transfer-rpc-validation.test.ts` — PASS; 4 subtests passed, 0 failed

Follow-up batch 2 total: 11 commands passed, 0 failed. These are static migration/source contract checks or local unit tests. No PostgreSQL SQL was executed and no Supabase project was queried or changed.

### Environment and release decision

`psql`, `supabase`, and `docker` are not available on PATH on the authorized workstation. Do not install or use a paid service without approval. The staging project remains uninitialized per the earlier read-only audit; no staging database tests were run. Production remains read-only and untouched. Critical release blockers remain open until a schema-matched isolated database run verifies the actual grants, RLS behavior, migration effects, and financial RPC authorization.


## Follow-up batch 3 — withdrawal approval schema audit (2026-10-23)

### Confirmed local migration-chain inconsistency — HIGH / OPEN

Inspected `supabase/migrations/20260928040000_withdrawal_security_boundary_hardening.sql` and searched all `supabase/migrations` for definitions/additions of the affected columns.

- `public.approve_withdrawal(UUID, UUID)` updates `public.withdrawals.approved_by` and `public.withdrawals.approved_at` (function body around lines 472–474).
- The base `public.withdrawals` definition in `20260831000000_init_schema.sql` defines `approved_by` but not `approved_at`.
- The alternate `CREATE TABLE IF NOT EXISTS public.withdrawals` in `20260905000000_hot_wallet_hardened.sql` defines neither `approved_by` nor `approved_at`.
- The only migration found adding both approval columns is `20260903000004_add_needs_approval_to_onchain_withdrawals.sql`, and it adds them to `public.onchain_withdrawals`, not `public.withdrawals`.
- Search of the local Supabase migration directory found no later `ALTER TABLE public.withdrawals ADD COLUMN ... approved_by/approved_at` migration.
- The approval function also inserts the hard-coded audit email `admin_approver@paxones.com`; this is misleading audit attribution and should be replaced with a trusted server-derived identity/email or a nullable/unknown value where appropriate.
- The later `20260928040000_withdrawal_security_boundary_hardening.sql` migration revokes `approve_withdrawal` from `authenticated` and grants it to `service_role, postgres`, but this does not repair missing table columns.

This is a source/migration-chain finding only. No database was queried, no migration was applied, and live production schema remains unverified. Do not add columns or modify this function blindly: the production ledger does not match the local migration filename set, and `withdrawals` has multiple competing schema definitions. The safe fix requires first reconciling the actual deployed table contract, then preparing a forward-only migration and regression test against an isolated schema-matched PostgreSQL database.

### Commands/evidence

- `rg` search across `supabase/migrations` and `src/lib/db/migrations` for withdrawal table definitions and approval columns — confirmed only `onchain_withdrawals` receives both approval columns in the inspected migration chain.
- `rg` search for profile role fields found `role` and `is_admin` are added by `20261006000000_lockdown_user_profile_security.sql`, so the `approve_withdrawal` profile predicate is at least represented in later local migrations; it still requires runtime/schema validation.
- No tests were added or executed in this audit-only step. No source/SQL changed; only this report was appended.


## Follow-up batch 4 — withdrawal RPC caller/signature audit (2026-10-23)

### Confirmed local migration-chain RPC contract mismatch — HIGH / OPEN

Compared every local definition of `public.process_failed_withdrawal` with its TypeScript callers:

- `src/jobs/withdrawalWorker.ts` calls the RPC with `p_is_verified_unbroadcast: true` for confirmed pre-broadcast failures, and `p_is_verified_revert: true` for confirmed EVM/TRON on-chain reverts.
- `src/app/api/withdraw/refund/route.ts` and `src/app/api/admin/withdrawals/review/route.ts` also send `p_is_verified_unbroadcast`.
- The latest local migration definition found, `supabase/migrations/20260929000000_withdrawal_double_payout_and_state_hardening.sql`, declares only `p_is_verified_unbroadcast BOOLEAN DEFAULT FALSE` as its final parameter; it no longer declares `p_is_verified_revert`.
- The prior migration `20260928020000_withdrawal_hardened_rpcs.sql` had both booleans, while `20260928040000_withdrawal_security_boundary_hardening.sql` reduces the function to only `p_is_verified_revert`; the next migration switches to only `p_is_verified_unbroadcast`. No later migration in the local directory restores both named arguments.
- This means the on-chain-revert callers may fail PostgREST RPC function resolution against the final local definition, depending on the deployed schema. It is a serious payout/refund workflow defect; do not “fix” by relabeling an on-chain revert as a pre-broadcast failure because the safety semantics differ.
- Existing `tests/withdrawal-idempotency-migration.test.ts` asserts a two-flag contract against an earlier migration file, but does not assert that the final migration-chain definition matches all live callers. This is a regression-test gap.

### Verification

- `node scripts/check-migration-versions.mjs` — PASS; 134 migration files, 134 unique valid prefixes.
- `git diff --check` — exit 0; Git emitted line-ending normalization warnings only.
- This was a static source/migration audit. No database-backed RPC resolution was performed. No SQL or application source was changed; only this report was appended.

### Safe remediation path

Prepare a forward-only migration that preserves both distinct safety flags and the verified state checks, with exact signature/privilege grants, only after reviewing the full current `process_failed_withdrawal` implementation and reconciling production's deployed function signature. Add a test that parses the latest migration definition and compares every named argument used by worker and route callers. Then execute negative/positive RPC tests on a schema-matched isolated PostgreSQL database. Do not apply to production or staging during this audit.


## Follow-up batch 5 — refund authorization and broadcast-safety audit (2026-10-23)

### Confirmed critical refund-safety flaw in latest local migration — CRITICAL / OPEN

Inspected the full `process_failed_withdrawal` body in `supabase/migrations/20260929000000_withdrawal_double_payout_and_state_hardening.sql` plus the two API callers.

- The latest local function declares only `p_is_verified_unbroadcast`; it has no distinct `p_is_verified_revert` parameter.
- Its broadcast guard is `IF tx_hash is populated AND NOT COALESCE(p_is_verified_unbroadcast, FALSE) THEN RAISE`. This is inverted for the intended safety property: passing the “verified unbroadcast” flag bypasses the guard even if a transaction hash is already recorded.
- The following `processing`/`ambiguous_broadcast` guard is also bypassed by `p_is_verified_unbroadcast = TRUE`, after which the function can proceed to credit `wallet_assets.balance` and release `in_withdrawal`.
- `src/app/api/admin/withdrawals/review/route.ts` calls the refund RPC with `p_is_verified_unbroadcast: true` when an admin rejects a withdrawal, without first proving the withdrawal is pre-broadcast. Admin authentication is present, but the route's flag does not establish chain state.
- `src/app/api/withdraw/refund/route.ts` requires `verifyWorkerAuth`, which is a useful route boundary, but also unconditionally passes the same flag. Worker authentication does not itself prove a particular withdrawal was never broadcast.
- The older migration `20260928020000_withdrawal_hardened_rpcs.sql` had separate flags and checked both records, transaction hashes, eligible statuses, and wallet liability before refunding. The latest local migration drops those important protections while retaining only the unbroadcast flag.

This is a potentially double-payout / incorrect refund path and must be treated as release-blocking. No runtime exploitation was attempted. No database was queried or modified.

### Required safe fix (not applied)

Do not trust a caller-provided boolean as proof of blockchain state. Restore a separate, internally validated path for (a) confirmed pre-broadcast failures, requiring both withdrawal records to have eligible states and no tx hash/txid, and (b) confirmed on-chain reverts, requiring a verified reverted receipt and matching persisted transaction hashes. Both paths must lock and reconcile both records, verify the exact `wallet_assets.in_withdrawal` liability before credit, update both statuses atomically, and keep idempotent ledger writes. The admin reject path must use a database state transition that refuses any withdrawal with a broadcast hash or ambiguous/broadcast state. The worker path must pass only evidence produced by its chain verification flow, and RPC execution must remain service-role-only.

Because the deployed production schema and migration history differ from local filenames, the fix must be a forward-only migration based on the verified deployed function definition, rehearsed on an isolated schema-matched PostgreSQL instance, and covered by tests for hashed pre-broadcast rows, ambiguous broadcast, confirmed/reverted receipts, mismatched hashes, missing liability, duplicate calls, and concurrent calls. No production/staging application was performed in this step.

### Evidence / status

- Inspected `src/app/api/withdraw/refund/route.ts`, `src/app/api/admin/withdrawals/review/route.ts`, `src/jobs/withdrawalWorker.ts`, and the full refund function in the latest local migration.
- No source or SQL changes; only this report was appended.
- CRITICAL: open; release blocked.


## Follow-up batch 6 — withdrawal refund regression gate (2026-10-23)

Added `tests/withdrawal-refund-broadcast-safety-regression.test.ts` as a test-first regression gate for the confirmed refund safety defect. It asserts that the canonical refund RPC has distinct pre-broadcast and on-chain-revert paths, rejects hashes on pre-broadcast refunds, validates persisted hashes on revert refunds, requires the exact locked liability, and prevents the admin route from setting a caller-side `p_is_verified_unbroadcast: true` flag.

- Command: `npx tsx tests/withdrawal-refund-broadcast-safety-regression.test.ts`
- Result: **FAIL (expected red regression)** at the first assertion: latest canonical local migration does not declare both `p_is_verified_revert` and `p_is_verified_unbroadcast`. This test currently demonstrates the release blocker; it is not a passing test suite.
- `git diff --check` completed with only pre-existing line-ending warnings; no whitespace errors reported.
- No SQL/application source changes, no database operations, no commit/push/deploy. New regression test and this report are local uncommitted files.

Next: reconcile the actual deployed schema/function and local migration order before authoring a forward-only repair. Do not apply a migration until it has been rehearsed against a schema-matched isolated PostgreSQL instance; current environment has no `psql`, Supabase CLI, or Docker available.


## Follow-up batch 7 — refund caller evidence and migration-boundary review (2026-10-23)

### Caller trace

- `src/jobs/withdrawalWorker.ts` calls the revert refund only after chain-specific receipt/status checks: TRON `success === false`; EVM `status === 0`. These branches are materially stronger evidence than the RPC boolean itself, but the SQL RPC does not independently bind that evidence to the transaction hash or receipt.
- The pre-broadcast worker branch passes `p_is_verified_unbroadcast: true` when `isLocalCheckStage` is true. This is an application control-flow claim, not a database-verifiable proof; the database must still reject any hash on either record and require safe states on both records.
- `src/app/api/admin/withdrawals/review/route.ts` unconditionally passes `p_is_verified_unbroadcast: true` on rejection. This must not be accepted as proof. Rejection must invoke a state-checked database transition that rejects transaction hashes and any processing/broadcast/ambiguous state.
- `src/app/api/withdraw/refund/route.ts` is worker-authenticated but also unconditionally asserts the unbroadcast flag. Worker authentication does not prove that the particular withdrawal was never broadcast.

### Migration boundary / extra blocker

The historical `20260928020000_withdrawal_hardened_rpcs.sql` contains the safer six-argument function with two explicit paths, paired-row locks/state/hash checks, and a guarded `wallet_assets.in_withdrawal >= v_total_refund` update. However, `20260928040000_withdrawal_security_boundary_hardening.sql` changes the signature back to five arguments and does not retain the paired-row checks. `20260929000000_withdrawal_double_payout_and_state_hardening.sql` then drops/recreates the five-argument function, retains the caller-controlled unbroadcast bypass, and uses `GREATEST(0, in_withdrawal - v_total_refund)` without requiring the liability to cover the refund. The later `20261009000000_archive_and_disable_obsolete_financial_rpcs.sql` also assumes a five-argument canonical signature in its preflight. Therefore simply restoring the six-argument function in an earlier migration is not a valid fix; the actual deployed canonical signature, privilege grants, and later preflights must be reconciled together.

### Decision

No SQL repair was authored or applied in this batch. The only safe next deliverable is a schema-aware forward migration after confirming the deployed function and both withdrawal table definitions. That migration must update all dependent preflights/grants and every caller consistently; it must not accept the two boolean flags as proof by themselves. Required test cases include hash on either row, mismatched hash/txid, processing/ambiguous state, missing/insufficient liability, explicit reverted receipt bound to the persisted hash, pre-broadcast validation failure, duplicate/concurrent calls, and admin rejection. The regression test added in batch 6 remains intentionally red against the current local canonical function and documents the blocker.

No database read/write was performed, no secrets or production rows accessed, and no commit/push/deploy occurred. Environment still lacks PostgreSQL/Supabase CLI/Docker for isolated execution.


## Follow-up batch 8 — broadened withdrawal refund regression contract (2026-10-23)

Expanded `tests/withdrawal-refund-broadcast-safety-regression.test.ts` to additionally assert that neither admin rejection nor the manual refund endpoint self-asserts `p_is_verified_unbroadcast`, that refund logic does not clamp a deficient liability with `GREATEST(0, ...)`, and that TRON/EVM worker revert branches require explicit failed on-chain results. The test still fails at the first assertion because the current canonical five-argument SQL function lacks the distinct revert/unbroadcast paths; subsequent assertions are not yet reached. This is an expected red regression gate, not a passing safety test.

Verification: `npx tsx tests/withdrawal-refund-broadcast-safety-regression.test.ts` — FAIL (exit 1; first assertion). `git diff --check` — exit 0 (only existing LF/CRLF conversion warnings). No application SQL or route code changed; no DB operations; no commit/push/deploy. A live SQL repair remains blocked until the deployed schema and migration history can be reconciled and an isolated PostgreSQL rehearsal environment is available.


## Follow-up batch 9 — read-only withdrawal schema preflight (2026-10-23)

Created `docs/withdrawal-refund-preflight-readonly.sql`, a metadata-only SQL preflight with seven SELECT statements to inspect: database context, deployed refund/broadcast function overloads and full definitions, actual columns/types, table constraints, indexes, effective EXECUTE grants, and migration-ledger table discovery. It deliberately does not read user withdrawal/balance rows, secrets, or auth tokens, and it contains no mutating SQL.

Static guard verification: mutation-statement scan found 0 statements; SELECT count 7. `git diff --check` exit 0 with only existing LF/CRLF warnings. The SQL has not been executed against production or staging; it has not been parsed by PostgreSQL because no `psql`, Supabase CLI, or Docker is available. The deployed schema is still unverified. Existing intentional-red regression test remains failing at its first assertion; no production/staging DB writes and no commit/push/deploy.


## Follow-up batch 10 — full withdrawal refund regression inventory (2026-10-23)

Added `tests/withdrawal-refund-broadcast-safety-audit.test.ts` to report all contract checks in one run instead of stopping at the first failure. Run: `npx tsx tests/withdrawal-refund-broadcast-safety-audit.test.ts` -> **3/10 passed, 7 failed**. Passing checks: canonical function is present/closed; worker's TRON path is conditioned on an explicit failed result; EVM path is conditioned on receipt status zero. Failing checks: distinct revert/pre-broadcast flags; pre-broadcast hash rejection; persisted/matching hash validation on revert; sufficient locked-liability guard; no liability clamp; admin route does not assert unbroadcast; manual refund route does not assert unbroadcast. These are source-contract checks, not live DB behavior tests.

This provides a more complete regression baseline; it does not fix the defect. No SQL was executed, no production/staging data was changed, and no commit/push/deploy occurred. Next step remains a forward-only repair drafted only after deployed schema/signature/grant preflight is reviewed and an isolated PostgreSQL instance is available.


## Follow-up batch 11 — remove caller-asserted pre-broadcast refund bypass (2026-10-23)

Targeted changes removed `p_is_verified_unbroadcast: true` from three callers: `src/app/api/admin/withdrawals/review/route.ts`, `src/app/api/withdraw/refund/route.ts`, and the pre-broadcast catch branch in `src/jobs/withdrawalWorker.ts`. These callers no longer self-assert that broadcast did not occur. This is a fail-closed mitigation, not the final RPC repair: legitimate pre-broadcast refunds can now remain reserved/blocked pending a database-side verified state transition, so operational follow-up is required. On-chain revert calls still pass `p_is_verified_revert: true`, while the current local canonical SQL signature does not support that argument; this mismatch remains a blocker.

Updated `tests/withdrawal-refund-broadcast-safety-audit.test.ts` to include the worker caller. Run `npx tsx tests/withdrawal-refund-broadcast-safety-audit.test.ts` -> **6/11 passed, 5 failed**. The three caller self-assertion checks now pass. Remaining failures are the separate SQL verification paths, hash matching, sufficient liability guard, and removal of liability clamping. TRON/EVM explicit-failure path checks pass. `git diff --check` exit 0 with existing LF/CRLF warnings. `npx tsc --noEmit` was started but no completion/exit code was observed during this batch, so it is not counted as a pass. No DB writes, commit, push, or deployment.


## Follow-up batch 12 — production withdrawal RPC read-only schema verification (2026-10-23)

Used the connected Supabase SQL tool for **SELECT-only** inspection of production project `eaiwgfxoiwxepinvcykg` (`paxonesflows`). No SQL writes or migrations were executed.

Confirmed deployed signature: `public.process_failed_withdrawal(uuid,text,numeric,text,boolean)`. The live definition has the caller-controlled `p_is_verified_unbroadcast` bypass, blocks `processing` / `ambiguous_broadcast` only when that caller flag is false, and decrements `wallet_assets.in_withdrawal` using `GREATEST(0, in_withdrawal - v_total_refund)`. Its ACL output lists `postgres`, `service_role`, and `supabase_auth_admin` EXECUTE; `information_schema.routine_privileges` returned those same three roles (no `anon` or `authenticated` row in this query result).

Confirmed production schema mismatch: `wallet_assets` has `user_id`, `asset_symbol`, `balance`, `locked_balance`, `reserved_balance`, `in_escrow`, `in_withdrawal`, but no `wallet_id` column. Production `ledger_entries` has columns such as `user_id`, `crypto`, `amount`, `type`, `reference_id`, `balance_after`, `asset`, `chain`, `status`, but not the columns the deployed refund RPC inserts (`wallet_id`, `asset_code`, `delta_available`, `delta_locked`, `available_after`, `locked_after`, `entry_type`, `ref_table`, `ref_id`, `idempotency_key`). Therefore the function's ledger INSERT is incompatible with the inspected production table definition and is expected to raise an undefined-column error when reached; the enclosing Postgres transaction should roll back prior balance/status changes. This is a confirmed critical operational blocker, but no live withdrawal was invoked to test it.

Production `onchain_withdrawals` includes `wallet_id`, `tx_hash`, status and idempotency key. Both `onchain_withdrawals` and `withdrawals` contain `tx_hash`, so a safe refund fix must inspect/lock both paired rows and reject either row's recorded hash, unless an independently verified revert proof is tied to that exact persisted hash. Current function does not implement a separate verified-revert argument and cannot validate caller-provided evidence.

Next safe step is design a forward-only SQL migration against the **actual production schema**, using `ledger_entries`' real columns and paired withdrawal state. Do not apply it to production. The configured staging project is known to be empty, and no local PostgreSQL/Supabase CLI/Docker is available to execute a true isolated rehearsal yet. No production writes, commits, pushes, or deploys.


### Additional production constraint findings (SELECT-only)

The live `ledger_entries_type_check` constraint permits only `deposit`, `withdrawal`, `withdrawal_pending`, `transfer`, and `fee`; it does not permit `withdrawal_refund`. Therefore fixing only the INSERT column names would still leave the current refund RPC violating the ledger type constraint. Do not loosen this constraint casually; first confirm the accounting/reporting model and select a schema-compatible ledger entry strategy.

The live `wallet_assets` table has `UNIQUE (user_id, asset_symbol)` and an `in_withdrawal` liability column. A safe refund must update exactly one row and assert the returned row plus sufficient liability before marking either withdrawal row failed. The live `onchain_withdrawals` table has a unique `tx_hash` constraint and a status check including `PROCESSING`, `AMBIGUOUS_BROADCAST`, `BROADCASTED`, `CONFIRMED`, `COMPLETED`, `FAILED`, and `CANCELLED`. Missing/empty tx hash alone must not be treated as proof of non-broadcast.

The live refund RPC is incompatible with the live ledger schema in multiple independent ways (column names and ledger type constraint), in addition to the caller-controlled safety bypass and insufficient-liability clamp. This batch stopped at read-only discovery; no migration was applied or executed. A safe repair requires a reviewed accounting entry mapping and isolated PostgreSQL rehearsal before production approval.


## Follow-up batch 13 — locate schema-compatible production refund implementation (2026-10-23)

Read-only production inspection found a second RPC, `public.refund_custodial_withdrawal(uuid,text)`, which writes the live `ledger_entries` schema using `user_id, crypto, amount, type, reference_id, balance_after, metadata, asset, chain, status` and records the allowed ledger `type='withdrawal'`. It also locks the `onchain_withdrawals` row and `wallet_assets` row, restricts normal refunds to `PENDING` / `NEEDS_APPROVAL`, and fails closed if `in_withdrawal` is less than amount plus fee. This is a useful existing schema-compatible accounting pattern; it is not automatically safe to call as a replacement without further hardening.

Critical gaps in that RPC: it does not reject a populated `onchain_withdrawals.tx_hash`; it only locks/updates `onchain_withdrawals` and does not lock or synchronize the paired `withdrawals` row; its idempotent terminal-state branch returns success for `FAILED` / `CANCELLED` / `REJECTED` without verifying a matching refund ledger entry; it inserts a ledger row without an idempotency key or unique reference guard. The wrapper `cancel_custodial_withdrawal(uuid,text)` delegates to it only after checking status is `PENDING` or `NEEDS_APPROVAL`, but the refund RPC itself is executable as a separate function and must be assessed by its own ACL and caller paths.

This confirms a better starting point for the forward repair: preserve the live ledger column/type contract, add paired-row locking and state/hash consistency checks, add robust idempotency, require a database-verifiable failure proof for any transaction with a hash, and audit all EXECUTE grants/callers. No live function was invoked and no database mutation occurred. No migration draft was applied or executed.


## Follow-up batch 14 — refund RPC callers and deployed EXECUTE grants (2026-10-23)

Read-only production ACL query confirmed the owner and explicit EXECUTE ACL for all three refund-related RPCs:

- `public.process_failed_withdrawal(uuid,text,numeric,text,boolean)` — owner `postgres`; ACL: `postgres`, `service_role`, `supabase_auth_admin`.
- `public.refund_custodial_withdrawal(uuid,text)` — owner `postgres`; ACL: `postgres`, `service_role`, `supabase_auth_admin`.
- `public.cancel_custodial_withdrawal(uuid,text)` — owner `postgres`; ACL: `postgres`, `service_role`, `supabase_auth_admin`.

The inspected ACLs show no explicit `anon` or `authenticated` grant. Because PostgreSQL default PUBLIC EXECUTE is a separate concern, the reported ACL representation alone should not be interpreted as proving the effective PUBLIC privilege is absent; `has_function_privilege('anon', ... , 'EXECUTE')` and `has_function_privilege('authenticated', ... , 'EXECUTE')` should be checked directly before closing the access-control finding.

Local source call graph has four callers: pre-broadcast failure in `src/jobs/withdrawalWorker.ts`, TRON revert path in the worker, EVM revert path in the worker, `src/app/api/withdraw/refund/route.ts`, and `src/app/api/admin/withdrawals/review/route.ts` (five call sites total). They all use the service-role Supabase client. The TRON/EVM callers pass `p_is_verified_revert: true`, but production only exposes the five-argument signature with `p_is_verified_unbroadcast`; the revert parameter is unsupported by the live function. The API/admin callers no longer pass `p_is_verified_unbroadcast: true` after local mitigation, so they fail closed for hashes/ambiguous states but still rely on the unsafe/incompatible RPC for ordinary cases. The worker pre-broadcast call no longer passes the flag, but the current RPC can still refund a normal non-hash row without verifying both paired rows or sufficient liability.

The alternative `refund_custodial_withdrawal` and its `cancel_custodial_withdrawal` wrapper also have service-role callers/permissions that need a complete effective-privilege audit. Do not replace the canonical function by routing to the alternative until its recorded-hash check, paired-row synchronization, and ledger idempotency are fixed. This batch is source/ACL tracing only: no production function was invoked, no DDL/DML was run, and no migration was applied.


Effective privilege check completed using `has_function_privilege` on production (SELECT-only): for each of the three functions, `anon_can_execute=false`, `authenticated_can_execute=false`, and `service_role_can_execute=true`. This closes the specific direct anon/authenticated EXECUTE-grant question for the inspected signatures. It does not resolve the unsafe business logic, service-role caller exposure, or signature mismatch.


## Follow-up batch 15 — refund idempotency and paired-row relationship (2026-10-23)

Additional production SELECT-only inspection found:

- `public.ledger_entries` has no unique index keyed to a withdrawal-refund `reference_id` or a general idempotency key. Existing partial unique indexes cover deposits and selected trade refund/settlement prefixes only. The custodial refund RPC therefore cannot currently rely on a unique ledger constraint to prevent a duplicate refund.
- The only reported foreign key among `withdrawals`, `onchain_withdrawals`, and `ledger_entries` is `onchain_withdrawals.wallet_id -> wallets.id`. No FK establishes a pairing between `withdrawals` and `onchain_withdrawals`; shared UUID equality is plausible from application code but must be verified from creation paths and schema constraints before assuming it.
- Both withdrawal tables have a `tx_hash` column. Any unified refund routine must inspect both rows under deterministic row-lock ordering, verify IDs/user/asset/network/amount/fee are consistent where both records exist, and reject any non-empty hash unless a separately authenticated verifier proves that exact persisted transaction reverted on-chain. Caller-supplied booleans are not proof.
- A ledger idempotency design must use a verified production-compatible uniqueness strategy, and ensure status change, balance credit, liability release, and ledger insert are one atomic transaction. The live ledger type constraint permits `withdrawal`, not `withdrawal_refund`; do not add a new ledger type without a deliberate schema/data compatibility review.

No migration was drafted or applied in this batch because the paired-row linkage and ledger uniqueness semantics need more evidence first. Production remains read-only; no financial rows or user records were queried.


## Follow-up batch 16 — withdrawal creation linkage and live idempotent wrapper check (2026-10-23)

The live production `public.request_withdrawal(uuid,text,text,numeric,numeric,text,numeric)` definition confirms the canonical creation path inserts `public.withdrawals` and `public.onchain_withdrawals` with the exact same generated UUID and `wallet_id` in one transaction. It then records a `withdrawal_lock` ledger entry with a per-withdrawal idempotency key. This provides source-level evidence for the pairing for withdrawals created through this specific RPC; legacy/manual records still require care.

A direct read-only `to_regprocedure` check found the production canonical request RPC exists, but `public.request_withdrawal_idempotent(uuid,text,text,numeric,numeric,text,numeric,text)` does **not** exist. Local `src/lib/services/withdrawalService.ts` calls this wrapper whenever a caller supplies an idempotency key, and local migration `20261019180000_add_idempotent_withdrawal_wrapper.sql` defines it. Given the migration ledger mismatch already documented, this is a confirmed app-to-production RPC mismatch: withdrawal requests using an idempotency key will fail unless a different deployed overload exists (none was returned by the exact signature check). Do not apply the local migration blindly; reconcile the live schema and its dependencies first.

This adds a separate HIGH release blocker alongside the refund RPC issues. All production inspection in this batch was SELECT-only. No withdrawal requests were made and no financial records were read.


## Follow-up batch 17 — complete withdrawal idempotency RPC parity check (2026-10-23)

Read-only production signature checks confirm both application-required idempotency RPCs are missing:

- `public.request_withdrawal_idempotent(uuid,text,text,numeric,numeric,text,numeric,text)` — absent.
- `public.lookup_withdrawal_idempotency_replay(uuid,text,text,text,numeric,text)` — absent.
- `public.request_withdrawal(uuid,text,text,numeric,numeric,text,numeric)` — present.

Local `src/lib/services/withdrawalService.ts` calls the replay lookup before mutable checks and calls the idempotent wrapper for reservation. Both function definitions are present in local migrations `20261020200000_withdrawal_idempotency_replay_lookup.sql` and `20261019180000_add_idempotent_withdrawal_wrapper.sql`, but neither exists in production under the exact expected signature. Thus the idempotent request flow is missing two production dependencies, not just one. Applying either migration separately is not a complete repair; the lookup function depends on `withdrawal_idempotency_keys`, created by the wrapper migration, and both need a schema-matched rehearsal and coordinated release.

Verification: `npx tsx tests/withdrawal-idempotency-migration.test.ts` passed (static source-contract test only; it does not execute PostgreSQL). `npx tsc --noEmit` was started but the process result was not yet observed at the time this note was written, so it is not counted as a pass. Production was queried read-only; no RPC was invoked and no data or schema changed.


## Follow-up batch 18 — idempotency migration dependency and rehearsal readiness (2026-10-23)

Reviewed both local idempotency migrations as a pair. The replay lookup references `public.withdrawal_idempotency_keys`, which is created by `20261019180000_add_idempotent_withdrawal_wrapper.sql`; therefore the lookup migration cannot be applied independently. Both migrations revoke execution from `PUBLIC`, `anon`, and `authenticated`, and grant execution to `service_role` and `postgres`. The app uses the service-role client for both calls. These are source observations only; they do not prove live ACLs or runtime behavior.

Rehearsal blockers remain: production's migration ledger cannot be reconciled to the 134 local migrations, and the connected staging project is empty/uninitialized. The workstation has no `psql`, Supabase CLI, or Docker available, so a PostgreSQL transaction/concurrency rehearsal could not be run. No tool was installed and no database was modified. Do not apply the migrations to production or initialize the staging project without an explicit staging-write authorization and a reviewed migration plan.

Verification in this batch:
- `npx tsx tests/withdrawal-idempotency-migration.test.ts` — PASS (static contract only).
- `node scripts/check-migration-versions.mjs` — PASS (134 files, 134 unique valid prefixes; does not reconcile live history).
- `git diff --check` — PASS (line-ending conversion warnings only).
- No PostgreSQL execution/concurrency test was run.

Next safe engineering action: prepare a disposable schema-matched PostgreSQL rehearsal target from a verified schema snapshot, replay both migrations in order, and test same-key replay, changed-payload conflict, concurrent identical requests, concurrent conflicting requests, rollback after reservation failure, and least-privilege EXECUTE grants. No commits, pushes, or deployments were made.


## Follow-up batch 19 — harden idempotency SECURITY DEFINER search paths (2026-10-23)

Reviewed the two local withdrawal-idempotency RPC migrations. Both are `SECURITY DEFINER` and previously set `search_path` to `public` (the wrapper also included `auth`). Although a production read-only ACL query confirmed `anon`, `authenticated`, and `service_role` cannot CREATE objects in `public`, an empty search path is the safer invariant for privileged functions and reduces dependence on schema CREATE ACLs. Updated both local functions to `SET search_path = ''`; referenced application tables/functions are explicitly schema-qualified. Added static regression assertions to `tests/withdrawal-idempotency-migration.test.ts` so both functions retain the empty search path.

Verification:
- `npx tsx tests/withdrawal-idempotency-migration.test.ts` — PASS.
- `git diff --check` — PASS, line-ending conversion warnings only.
- Production query was SELECT-only and showed `public` CREATE is false for `anon`, `authenticated`, and `service_role` (true for `postgres`). No production function definitions or grants were changed.

This is a local-source hardening change only. It has not been replayed against PostgreSQL, and the two RPCs remain absent in production. The migration chain mismatch and lack of a disposable PostgreSQL rehearsal environment remain blockers. No commit, push, or deployment.


## Follow-up batch 20 — verify idempotency privileged-function identity and search-path boundary (2026-10-23)

Reviewed both local idempotency SQL function bodies and the withdrawal service authentication path. The service obtains a verified user through Supabase `auth.getUser()` / `auth.admin.getUser(token)` before invoking the idempotency RPCs with `user.id`. The privileged wrapper serializes requests by locking that user's `profiles` row, then locks/checks the user-scoped idempotency key; the replay lookup is read-only. Both `SECURITY DEFINER` functions now use `SET search_path = ''` from batch 19 and use schema-qualified object references. Direct table access to the idempotency key table is revoked from PUBLIC/anon/authenticated and limited to service_role/postgres.

Verification in this batch:
- `npx tsx tests/withdrawal-idempotency-migration.test.ts` — PASS (output confirmed).
- A combined `npx tsc --noEmit` and `git diff --check` run was started, but its final process exit was not captured in this batch; do not count those as newly verified here. TypeScript had passed in batch 17.
- Production schema privilege query remained read-only: anon/authenticated/service_role cannot CREATE in public. No production mutation was performed.

Open risks: static tests do not prove PostgreSQL concurrency, function execution privileges after deployment, rollback atomicity, or compatibility with production's migration history. The two idempotency RPCs remain absent in production and cannot safely be deployed until migration reconciliation and an isolated database rehearsal are completed. No commit/push/deploy.


## Follow-up batch 21 — refund endpoint input and error hardening (2026-10-23)

Applied targeted local edits to `src/app/api/withdraw/refund/route.ts`:
- Require `withdrawalId` to be a non-empty string before invoking the RPC.
- Replace the raw RPC error response with a generic reconciliation-safe message while retaining server-side error logging.
- Replace the raw unexpected exception response with a generic 500 response while logging the exception server-side.

Added `tests/withdraw-refund-route-safety.test.ts` for input validation, worker-auth presence, and error sanitization.

Verification:
- `npx tsx tests/withdraw-refund-route-safety.test.ts` — PASS, exit code 0.
- `npx tsc --noEmit` — started; final process exit was not captured, so not counted as passed.
- Existing `tests/withdrawal-refund-broadcast-safety-regression.test.ts` — FAILS on its first assertion because the local canonical refund migration still exposes the old five-argument signature and caller-controlled `p_is_verified_unbroadcast` flag; it expects separate revert/unbroadcast proof arguments. This is a genuine outstanding critical refund-RPC defect, not a route-test failure.

No database was modified. No commit, push, or deployment. Endpoint hardening does not resolve the incompatible live ledger schema or broadcast/liability safety issues.


## Follow-up batch 22 — admin withdrawal review route hardening (2026-10-23)

Applied local targeted changes to `src/app/api/admin/withdrawals/review/route.ts`:
- Validate `withdrawalId` as a non-empty string and validate action against APPROVE/REJECT.
- Do not return raw approval/refund RPC errors or raw exception messages to callers; log server-side and return generic responses.
- Require the approval RPC result to explicitly return `success === true` before responding with success (previously any no-error RPC result was reported as approved).
- Added `tests/admin-withdrawal-review-route-safety.test.ts`.

Verification batch:
- `npx tsx tests/admin-withdrawal-review-route-safety.test.ts` — PASS, exit code 0.
- `npx tsx tests/withdraw-refund-route-safety.test.ts` — PASS, exit code 0.
- `git diff --check` — PASS, exit code 0; line-ending warnings only.
- No TypeScript run in this batch.

Important unresolved issues: the admin REJECT action still calls the known unsafe/incompatible `process_failed_withdrawal` production RPC; route hardening does not make the financial operation safe. Production's `approve_withdrawal` schema mismatch (missing approved_by/approved_at columns per prior audit) also remains unresolved pending live schema reconciliation. No database changes, commit, push, or deployment.


## Follow-up batch 23 — production approval RPC/schema compatibility audit (2026-10-23)

Read-only production SQL confirmed `public.approve_withdrawal(uuid,uuid)` is deployed and writes `approved_by` and `approved_at` to `public.withdrawals`. The live `information_schema.columns` result shows those two columns exist on `public.onchain_withdrawals`, but not on `public.withdrawals`. The current function therefore attempts to update nonexistent columns and the approval transaction will fail when it reaches that UPDATE. The same live function hardcodes `admin_approver@paxones.com` in its audit record, which does not represent the actual admin email.

The live schema also confirms paired tables have distinct schemas: `withdrawals` has `tx_hash`, `txid`, status and multiple legacy asset/network fields; `onchain_withdrawals` has `tx_hash`, `wallet_id`, `idempotency_key`, `approved_by`, and `approved_at`. Both tables expose `tx_hash`. No live row data was queried.

No SQL or schema changes were applied. I did not rewrite the historical migration because production's 81-entry migration ledger does not align with local migration filenames, and the staging project remains uninitialized; a speculative migration cannot be safely rehearsed there. Next safe action is prepare a new forward-only migration correcting approval metadata placement and requiring the paired on-chain row, add schema-compatibility tests, then rehearse on a schema-matched isolated database before any production approval.


## Follow-up batch 24 — UTXO deposit webhook chain verification (2026-10-24)

Inventory first:
- Branch: `fix/production-typecheck-batch-1` (branch command exit 0).
- `git status --short --branch` exit 0; working tree contains a large pre-existing set of modified and untracked files (153 changed paths in diff/stat plus untracked files; preserve them).
- `git rev-list --left-right --count origin/main...HEAD` exit 0: `1 64` (local branch is 64 commits ahead and 1 commit behind its tracked remote branch; this is not a comparison to origin/main).
- Baseline `npx tsc --noEmit` exit 0, output empty, captured in `C:\Users\theki\paxones-audit-logs\inventory-tsc.exit` and `inventory-tsc.txt`.

Changes in this batch:
- Added `src/lib/blockchain/verify-utxo-deposit.ts`. It fetches transaction and chain-tip data from HTTPS BTC/LTC explorer endpoints, validates transaction identity, exact output address/index, confirmed block, and derives amount/confirmations from explorer data rather than webhook-supplied amount/confirmation fields.
- Updated BlockCypher BTC and Litecoin webhook routes to call that verifier before invoking `process_deposit_atomic`; BTC requires at least 2 confirmations, LTC at least 6. Both retain shared-secret authentication supporting configured query `?key=`, bearer, and configured headers. Caller-provided amounts, block heights, and confirmation counts are no longer passed to the credit RPC.
- Added `tests/verify-utxo-deposit.test.ts`.

Backups:
- Copies of the two edited webhook routes and the pre-existing blockchain worker test were written to `C:\Users\theki\paxones-audit-logs\*.batch1.bak` before edits. The new helper and new test were newly created.

Verification:
- `npx tsx tests/verify-utxo-deposit.test.ts` — PASS, exit 0; 6 passed, 0 failed (captured in `batch24-utxo-tests.exit` and `batch24-utxo-tests.txt`).
- `git diff --check` — PASS, exit 0 (captured in `batch24-diff-check.exit`).
- A post-edit `npx tsc --noEmit` was started with redirected output, but its final exit code had not yet been captured when this report entry was written. Do not count post-edit typecheck as a pass until the exit file exists and is read.
- No live webhook event was submitted, no deposit RPC was called against production by this work, and no database changes were applied.

Limits/open work:
- This is not a complete deposit pipeline sign-off. Duplicate-event credit prevention still depends on the deployed `process_deposit_atomic` uniqueness/atomicity contract, which was not exercised here. No route-level unauthenticated/bad-secret HTTP tests or real explorer integration test was run yet. Explorer availability/response schema was mocked in unit tests, not live-tested. The broader deposit ingestion workers and EVM/TRON paths remain to be audited.
- Provider dashboard webhook URL configuration was not changed; configure BlockCypher's callback URL with `?key=<configured shared secret>` only if using query-key authentication, or use the supported secret header where the provider permits it. Do not paste the secret into logs or source control.
- No SQL was written or applied. Production remained read-only; staging remains empty/uninitialized. No commit, push, merge, or deployment was made.

Next: capture the post-edit TypeScript exit code, add route-auth/duplicate-event tests where feasible, then continue deposit-worker verification. After critical deposits, return to approval/refund RPCs and migration reconciliation. Do not push the current broad dirty tree to `main`: it is not a reviewed release candidate and contains uncommitted deletions/changes; preserve it until a clean reviewed integration plan is established.


Batch 24 verification addendum (after the initial report entry):
- Post-edit `npx tsc --noEmit` — PASS, exit code 0; captured in `C:\Users\theki\paxones-audit-logs\batch24-tsc-only.exit` (value 0) and `batch24-tsc-only.txt` (empty output). This supersedes the earlier note that the post-edit typecheck had not yet finished.
- `git diff --check` — PASS, exit code 0; captured in `batch24-diff-check.exit` (value 0).


## Follow-up batch 25 — deposit ingress fail-closed hardening (2026-10-24)

### Changes made

- `src/app/api/webhooks/alchemy/route.ts`: Alchemy webhook now returns HTTP 500 if its HMAC signing secret is not configured, and HTTP 401 when signature is missing/invalid. It no longer silently skips signature verification when the secret is absent.
- `src/app/api/wallet/deposit/route.ts`: endpoint now uses the shared fail-closed worker-auth helper; missing/placeholder secrets no longer bypass authentication.
- `src/app/api/webhooks/deposit/route.ts`: direct-secret validation now uses `timingSafeEqualString`, which safely rejects unequal-length values instead of allowing `crypto.timingSafeEqual` to throw and produce a 500.
- `src/app/api/internal/chain-ingest/route.ts`: shared-secret comparison now uses the same constant-time, length-safe helper.
- Added `tests/worker-auth-deposit-routes.test.ts` with worker auth positive/negative cases and static route contracts.
- Backups of the four modified existing route files were created in `C:\Users\theki\paxones-audit-logs\` with timestamp `20261024-082734`.

### Verification (all exit codes captured)

| Command | Exit | Result |
|---|---:|---|
| `npx tsx tests/worker-auth-deposit-routes.test.ts` | 0 | PASS — 6 tests, 0 failures |
| `npx tsx tests/verify-utxo-deposit.test.ts` | 0 | PASS — 6 tests, 0 failures |
| `npx tsc --noEmit` | 0 | PASS |
| `git diff --check` | 0 | PASS |
| `node scripts/check-migration-versions.mjs` | 0 | PASS — 134 files, unique valid migration prefixes |

Logs and each command's exit-code file are in `C:\Users\theki\paxones-audit-logs\batch25-*`.

### Production read-only observation

Read-only inspection of deployed `public.process_deposit_atomic` confirmed that the RPC accepts caller-provided amount, block number, confirmations, network, and provider parameters and uses the amount/confirmation values in its processing path. Therefore, route authentication alone is not proof of on-chain validity. Each public/provider ingress and every scheduled ingestion worker must verify transaction identity, destination, token/asset, exact on-chain amount, and confirmations before calling this RPC. This batch does not claim that all ingestion paths are safe.

### Still open / release remains blocked

- `/api/webhooks/deposit`, `/api/internal/chain-ingest`, `/api/wallet/deposit`, and `/api/webhooks/alchemy` still require a deeper per-network on-chain verification/idempotency audit; this batch hardens authentication but does not independently validate every asset/amount from chain data.
- Other deposit paths exist in `src/jobs/depositIngestion.ts`, `src/jobs/confirmationsWorker.ts`, and `src/app/api/workers/deposit-listener/route.ts`; those need end-to-end verification and duplicate-event tests.
- No SQL was written/applied. Production remains read-only. Staging remains uninitialized and was not modified. No commit, push, merge, workflow, or deployment occurred.
- Critical withdrawal/refund RPC and migration-history blockers remain open. Paxones is not production-ready.


## Follow-up batch 26 — ad-edit market validation regression (2026-10-24)

### Changes made

- `src/app/(dashboard)/ads/edit/[adId]/page.tsx`: market price now starts as unavailable (`0`) instead of a fabricated `1.0`. The UI no longer displays a fake USD/fiat market price when no valid quote exists. It records the original asset, fiat, pricing mode, price, and margin. Edits that leave pricing terms unchanged preserve the original price and are not blocked by a missing/stale market quote. Actual pricing changes fail clearly when no reference price is available.
- `src/app/api/ads/[adId]/route.ts`: server-side ±50% fixed-price validation still applies when switching to fixed pricing, changing the price, or changing the asset/fiat pair. It no longer requires a live market row for edits to unrelated fields when the fixed price and pair are unchanged.
- Added `tests/ad-edit-market-validation.test.ts` with regression contracts for these cases.
- Backups of the edit page and API route are in `C:\Users\theki\paxones-audit-logs\`, timestamp `20261024-083151`.

### Verification (exit codes captured)

| Command | Exit | Result |
|---|---:|---|
| `npx tsx tests/ad-edit-market-validation.test.ts` | 0 | PASS — 3 tests, 0 failures |
| `npx tsx tests/worker-auth-deposit-routes.test.ts` | 0 | PASS — 6 tests, 0 failures |
| `npx tsc --noEmit` | 0 | PASS |
| `git diff --check` | 0 | PASS; Git reported line-ending conversion warnings only |

Logs and exit-code files: `C:\Users\theki\paxones-audit-logs\batch26-*`.

### Production schema review and limits

Read-only schema review confirmed that production `ads` and `p2p_ads` contain the status/active/deletion columns used by the current handlers. The only reported foreign key referencing `ads` from the inspected FK query is `trades.ad_id -> ads.id ON DELETE SET NULL`. No ad row was queried or modified. These checks do not prove the user-facing edit/pause/delete flow works end-to-end; a live authenticated test in a safe, schema-matched staging environment is still needed.

No SQL was written/applied. Production remains read-only; staging remains uninitialized and unchanged. No commit, push, merge, workflow, or deployment occurred. Critical financial, migration-reconciliation, and broader runtime-test blockers remain open.


## Batch 27–28 — withdrawal refund and approval RPC forward fixes (2026-10-24)

### Read-only production evidence
- Production `public.process_failed_withdrawal(uuid,text,numeric,text,boolean)` accepts a caller-controlled `p_is_verified_unbroadcast` flag, references a `metadata` field not present on either deployed withdrawal table, writes nonexistent ledger columns and a disallowed ledger type, and clamps insufficient `in_withdrawal` liability with `GREATEST(0,...)`.
- Production `public.approve_withdrawal(uuid,uuid)` updates `withdrawals.approved_by/approved_at`, which do not exist on the deployed `withdrawals` table. Those columns exist on `onchain_withdrawals`. The function also writes a hardcoded administrator email and does not verify the paired row update affected a record.
- These findings were obtained from read-only function definitions and information_schema. No production rows were read or changed.

### Local forward-only migrations added (NOT APPLIED)
1. `supabase/migrations/20261024100000_withdrawal_refund_rpc_forward_hardening.sql`
   - Drops legacy 2-, 5-, and 6-argument refund overloads to prevent RPC ambiguity.
   - Refuses caller-supplied `p_is_verified_unbroadcast=true`; only explicit worker-confirmed revert can use the broadcast exception, and only with a persisted transaction hash and compatible state.
   - Locks both withdrawal rows and wallet asset; requires paired record; requires exact `in_withdrawal >= amount + fee`; rejects missing/insufficient liability rather than clamping.
   - Uses deployed ledger columns and allowed `type='withdrawal'`, `status='REFUNDED'`; checks ledger evidence before treating terminal retry as idempotent.
   - Updates both paired withdrawal statuses atomically and limits execution to service_role/postgres.
2. `supabase/migrations/20261024110000_withdrawal_approval_rpc_forward_hardening.sql`
   - Writes `approved_by/approved_at` to `onchain_withdrawals`, and only status/timestamp to `withdrawals`.
   - Locks and requires both paired records, checks admin membership, refuses any recorded tx hash/txid, supports safe idempotent approval retries, uses the actual profile email instead of a hardcoded address, and limits execution to service_role/postgres.
3. Added tests: `tests/withdrawal-refund-forward-hardening.test.ts`, `tests/withdrawal-approval-forward-hardening.test.ts`. Updated existing refund safety static tests to assert the forward migration instead of relying on the unsafe historical migration. Original versions of those two edited tests were backed up to `C:\Users\theki\paxones-audit-logs\pre-batch27-*.bak`.

### Verification (each exit code captured)
- `npx tsx tests/withdrawal-approval-forward-hardening.test.ts` — exit 0, 3 passed.
- `npx tsx tests/withdrawal-refund-forward-hardening.test.ts` — exit 0, 5 passed.
- `npx tsx tests/withdrawal-refund-broadcast-safety-regression.test.ts` — exit 0.
- `npx tsx tests/withdrawal-refund-broadcast-safety-audit.test.ts` — exit 0, 12/12 checks passed.
- `npx tsx tests/withdraw-refund-route-safety.test.ts` — exit 0.
- `npx tsx tests/withdrawal-idempotency-migration.test.ts` — exit 0.
- `npx tsc --noEmit` — exit 0.
- `node scripts/check-migration-versions.mjs` — exit 0, 136 migration files, 136 unique valid prefixes.
- `git diff --check` — exit 0; line-ending conversion warnings only.
- Full logs and individual exit-code files are in `C:\Users\theki\paxones-audit-logs\batch27-*` and `batch28-*`.

### Critical limitations
- SQL migrations have only static contract tests; they have NOT been executed by PostgreSQL or replayed against a schema-matched database. Production remains read-only and staging is still empty/uninitialized. Therefore these migrations are candidate fixes, not verified deployable fixes.
- The refund RPC's reverted-transaction exception relies on the service-role-only worker setting `p_is_verified_revert` after a chain receipt indicates failure. End-to-end worker tests and a DB-backed rollback/concurrency test remain required.
- The wider production release remains blocked by migration-history reconciliation, missing idempotency RPCs in production, deposit-ingestion coverage/idempotency, trade/escrow authorization, and other previously recorded high/critical findings.
- No commit, push, merge, deployment, workflow, production mutation, or staging mutation occurred.


## Batch 29 — deposit confirmations fail-closed verification (2026-10-24)

### Changes made
- `src/jobs/confirmationsWorker.ts` now refuses to call `process_deposit_atomic` when an independent chain lookup fails or the transaction/output cannot be verified. It no longer falls back to previously stored confirmation counts.
- Removed fabricated BTC/LTC confirmation counts (previously 2 or 6 whenever an explorer marked a transaction confirmed); BTC/LTC now use `verifyUtxoDepositOutput` to validate tx identity, exact destination address, output index, output amount, actual tip height, and derived confirmations.
- UTXO deposits with no recorded output index fail closed instead of assuming output 0.
- Removed the TRON hardcoded 19-confirmation fallback. TRON requires matching transaction ID, successful receipt, valid block height, and a valid current block before calculating confirmations.
- EVM requires matching receipt hash, successful receipt status, and consistent current block height before proceeding.
- The worker no longer falls back to `NEXT_PUBLIC_SUPABASE_ANON_KEY` or placeholder Supabase credentials. If service-role configuration is missing, it refuses to run financial writes.
- Backed up the prior worker source to `C:\Users\theki\paxones-audit-logs\pre-batch29-confirmationsWorker.ts.bak`.
- Added `tests/confirmation-worker-chain-verification.test.ts`.

### Verification (final exit codes captured)
- `npx tsx tests/confirmation-worker-chain-verification.test.ts` — exit 0, 5 passed.
- `npx tsx tests/verify-utxo-deposit.test.ts` — exit 0, 6 passed.
- `npx tsc --noEmit` — exit 0.
- `node scripts/check-migration-versions.mjs` — exit 0, 136 unique valid migration prefixes.
- `git diff --check` — exit 0; line-ending conversion warnings only.
- Final logs and exit files: `C:\Users\theki\paxones-audit-logs\batch29-*`.

### Scope limitation
This hardens the confirmation worker, not every deposit ingress. EVM/TRON token amount and contract/event revalidation across every ingress, the `process_deposit_atomic` database implementation, and duplicate-credit behavior still require schema-matched database tests and route-by-route verification. No SQL was applied; production and staging remain untouched. No commit, push, merge, workflow, or deployment occurred.

## Batch 30 — Deposit ingress confirmation trust (2026-10-24)

- Updated src/app/api/webhooks/deposit/route.ts, src/app/api/webhooks/alchemy/route.ts, and src/app/api/wallet/deposit/route.ts to pass p_confirmations: 0 into process_deposit_atomic. These ingress routes can register pending deposits but cannot claim that a caller-supplied or hard-coded confirmation count proves on-chain finality.
- Added tests/deposit-ingress-confirmation-trust.test.ts with three source regression checks.
- Backups saved before edits under C:\Users\theki\paxones-audit-logs\pre-batch30-*.bak.
- Not applied to production or staging. End-to-end DB-backed staging verification remains required to prove that the confirmation worker re-reads chain evidence and then safely credits.
- Verification exit codes: new regression test 0; existing worker-auth deposit route tests 0; npx tsc --noEmit 0; git diff --check 0; migration version validation 0 (individual logs and .exitcode files are in C:\Users\theki\paxones-audit-logs\batch30-*).
## Batch 31 — Background deposit ingestion fail-closed (2026-10-24)

- Updated src/jobs/depositIngestion.ts to require configured Supabase URL plus SUPABASE_SERVICE_ROLE_KEY; removed anon-key, placeholder-key, and hard-coded production-project fallback. The exported ingestion/recheck paths return without database access if service-role configuration is absent.
- All 12 process_deposit_atomic calls in the ingestion scanner/recheck module now pass p_confirmations: 0. Scanner success counters no longer infer credit from locally computed confirmation counts; they rely on the RPC's explicit credited status.
- Added tests/deposit-ingestion-no-direct-credit.test.ts.
- Backup saved at C:\Users\theki\paxones-audit-logs\pre-batch31-depositIngestion.ts.bak.
- Verification exit codes: deposit-ingestion regression tests 0; confirmation-worker chain tests 0; UTXO verifier tests 0; npx tsc --noEmit 0; git diff --check 0. See batch31-*.log and batch31-*.exitcode under the audit log directory.
- Important remaining blocker from production read-only inspection: process_deposit_atomic computes effective confirmations using GREATEST(submitted confirmations, existing onchain_deposits.confirmations). Thus p_confirmations: 0 does not neutralize an already-stored inflated confirmation count. The scanner still calls that RPC, so a dedicated pending-registration RPC / safe forward migration and duplicate/stale-record rehearsal are required before this path can be considered closed. No production or staging SQL was changed.

## Batch 32 — Pending-only deposit registration hardening (2026-10-24)

- Added local forward migration `supabase/migrations/20261024120000_deposit_pending_registration_hardening.sql`. It defines a dedicated service-role-only `register_pending_deposit` RPC, validates network/asset/token contract and unique address ownership, serializes transaction/output identity, rejects conflicting duplicate identities, inserts pending records with zero confirmations, and never credits `wallet_assets` or writes `ledger_entries`. Existing on-chain confirmation/status values are deliberately not overwritten by registration retries.
- Repointed all 12 RPC invocations in `src/jobs/depositIngestion.ts` and the deposit webhook, Alchemy webhook, and wallet deposit ingress routes to `register_pending_deposit`; those ingress paths can no longer invoke the crediting RPC directly.
- Hardened `src/jobs/confirmationsWorker.ts`: the worker now skips the crediting RPC until the independently verified on-chain confirmation count meets the required threshold. This is a necessary guard because the existing production RPC computes effective confirmations with `GREATEST(submitted, stored)`, so stale inflated DB counts are otherwise dangerous.
- Added `tests/deposit-pending-registration.test.ts` covering non-crediting SQL contract, ingress RPC routing, duplicate identity checks, privileges, and worker threshold ordering.
- Safety/verification limits: the Supabase CLI is not installed locally and `npx --no-install supabase migration new ...` exited 1 because the package is unavailable without fetching it. The migration was therefore authored as a local forward SQL file and has **not** been executed against production or staging. The staging project remains empty/uninitialized; no database writes were made. SQL compilation and real concurrent retry behavior still require a schema-matched disposable database before deployment.
- No commit, push, merge, or deployment performed. Pre-change backups were written for the ingress files, migration and report to `C:\\Users\\theki\\paxones-audit-logs\\` with the `pre-batch32-` prefix. A dedicated pre-batch32 backup of `src/jobs/confirmationsWorker.ts` was not created; that file was changed by one surgical edit.

### Batch 32 verification results

Final recorded exit codes (logs in `C:\\Users\\theki\\paxones-audit-logs\\`):
- `node_modules\\.bin\\tsx.cmd --test tests\\deposit-pending-registration.test.ts` — **0**, 3/3 passed.
- `node_modules\\.bin\\tsx.cmd --test tests\\deposit-ingestion-no-direct-credit.test.ts tests\\deposit-ingress-confirmation-trust.test.ts` — **0**, 5/5 passed.
- `node_modules\\.bin\\tsx.cmd --test tests\\confirmation-worker-chain-verification.test.ts tests\\verify-utxo-deposit.test.ts` — **0**, 11/11 passed.
- `node_modules\\.bin\\tsc.cmd --noEmit` — **0** after adding the required `depositId` field to the new pending-result detail.
- `git diff --check` — **0** (only existing LF/CRLF warnings).
- `node scripts\\check-migration-versions.mjs` — **0**, 137 migration files scanned, 137 unique version prefixes.
- Source audit: deposit ingestion **0** calls to `process_deposit_atomic`, **12** calls to `register_pending_deposit`; each of the three API ingress routes has 0 credit-RPC calls and 1 pending-registration call.

These are source/static/unit-test results only. The new SQL has not been parsed or executed by PostgreSQL; the CLI creation attempt exited 1 because Supabase CLI is not locally available and no package was fetched. Do not deploy this migration until it is rehearsed against a schema-matched disposable database and duplicate/concurrency cases are exercised.


## Batch 33 — Exact EVM/TRON transfer evidence verification (2026-10-24)

- Added `src/lib/blockchain/verify-evm-deposit.ts`: native ETH deposits now require the transaction recipient and exact wei value to match; ERC20/BEP20 deposits require matching transaction/receipt hashes, successful receipt, canonical token contract, exact destination, exact raw token amount, and the specific receipt log index.
- Updated `src/jobs/confirmationsWorker.ts` to fetch the EVM transaction as well as receipt/tip and to call the exact-transfer verifier before returning confirmations.
- Added `src/lib/blockchain/verify-tron-deposit.ts`: TRC20 verification requires exactly one confirmed Transfer event matching transaction id, canonical USDT contract, destination, six-decimal raw amount, event index, and block number. The worker now fetches confirmed TronGrid transaction events and fails closed when event data is unavailable or mismatched.
- Fixed the pending-registration migration's deposits insert so `from_address` cannot become NULL, matching the production schema's NOT NULL constraint; blank sender is represented as an empty string as the existing credit RPC does.
- Added tests `tests/verify-evm-deposit.test.ts` (4/4) and `tests/verify-tron-deposit.test.ts` (2/2); updated worker and pending-registration regression tests.

### Batch 33 verification

- EVM verifier tests: exit 0, 4/4.
- TRON verifier tests: exit 0, 2/2.
- Confirmation-worker + UTXO tests: exit 0, 11/11.
- Pending-registration tests: exit 0, 3/3.
- Deposit-ingress regression tests: exit 0, 5/5.
- `npx tsc --noEmit` equivalent (`node_modules\\.bin\\tsc.cmd --noEmit`): exit 0.
- `git diff --check`: exit 0, existing LF/CRLF warnings only.
- Migration-version preflight: exit 0, 137 files / 137 unique prefixes.
- Logs and exit codes saved as `batch33-final-*.log` and `batch33-final-*.exitcode` in `C:\\Users\\theki\\paxones-audit-logs\\`.

### Remaining safety gates

- The EVM/TRON verifiers are unit-tested with synthetic evidence; no live provider integration or end-to-end deposit test was run. In particular, confirm the configured TronGrid endpoint returns `event_index`, `contract_address`, and raw `result.value` in the expected schema; missing/mismatched data intentionally blocks credit.
- The Alchemy ingress currently uses output index `0` rather than a verified transfer-log index. This can cause legitimate token deposits to remain pending unless the actual matching log index is supplied. Audit and fix index propagation before enabling this path.
- The pending-registration SQL remains local-only and unexecuted. The staging database is empty/uninitialized; production is read-only. A schema-matched disposable PostgreSQL rehearsal is still mandatory before deployment.
- No production/staging writes, commit, push, merge, or deployment occurred. Backups: `pre-batch33-confirmationsWorker.ts.bak` and `pre-batch33-deposit-migration.sql.bak` in the audit log directory.


## Batch 34 — Resolve EVM token log index from on-chain receipt (2026-10-24)

- Added `src/lib/blockchain/resolve-evm-transfer-log-index.ts`. It resolves a transfer only when exactly one receipt log matches the canonical token contract, ERC-20 Transfer topic, destination, exact raw amount/decimals, and a valid block-global log index. Missing, malformed, mismatched, or duplicate matching logs fail closed.
- Updated `src/app/api/webhooks/alchemy/route.ts`: ERC-20 deposits now fetch the transaction and receipt through the configured Ethereum provider, validate transaction/receipt identity and successful status, then register the actual matching log index. The route no longer registers token deposits with `p_output_index: 0` by default. RPC evidence unavailable returns 503; ambiguous/mismatched transfer evidence returns 422; no pending record is created in those cases.
- Updated `src/app/api/webhooks/deposit/route.ts`: EVM token log indexes are derived from chain receipts even when the payload contains an index; the generic activity path no longer fabricates index zero. Missing/invalid non-EVM output/event indexes are rejected. ETH native transfers keep index zero because the verifier checks the native transaction itself.
- Updated `src/app/api/wallet/deposit/route.ts`: ERC20/BEP20 indexes are independently derived from chain evidence instead of trusting caller input or `Number(outputIndex) || 0`. Non-EVM deposits require a valid explicit output/event index; native ETH uses zero.
- Added `tests/resolve-evm-transfer-log-index.test.ts` for actual index propagation, missing/failed receipt, wrong destination/contract/amount, malformed indexes, duplicate matching logs, decimal precision, and nonpositive amounts. Extended ingress tests to guard against regression.
- Pre-change backups were saved in `C:\\Users\\theki\\paxones-audit-logs\\` as `pre-batch34-alchemy-route-20261024-092240.bak` and `pre-batch34-report-20261024-092240.bak`.

### Batch 34 verification

- Focused deposit and ingress suite: exit **0**, **37/37 tests passed** (includes resolver, ingress, EVM verifier, worker/UTXO, pending registration, ingestion, and worker-auth tests).
- `node_modules\\.bin\\tsc.cmd --noEmit`: exit **0**.
- `git diff --check`: exit **0**; only existing LF/CRLF warnings.
- `node scripts\\check-migration-versions.mjs`: exit **0**, 137 migration files / 137 unique version prefixes.
- Logs and exit-code files are saved as `batch34-final-*.log` and `batch34-final-*.exitcode` in `C:\\Users\\theki\\paxones-audit-logs\\`.

### Remaining gates / limits

- These are local unit/static/type checks; no live EVM provider integration, webhook end-to-end test, or real deposit was performed. The configured provider's receipt/log shape and availability still need staging-safe integration verification.
- Generic non-EVM webhooks now fail closed when the required output/event index is absent. Confirm upstream providers supply the correct BTC/LTC output index and TRON event index before relying on those paths.
- Full deposit lifecycle tests are still required for duplicate/concurrent registration, stale inflated confirmation records, retries, and idempotent worker credit. The pending-registration SQL migration remains local-only and unexecuted; staging is empty/uninitialized and production remains read-only.
- No database writes, commits, pushes, merges, workflows, or deployments occurred. Existing dirty work was preserved.


## Batch 35 — Deposit lifecycle regression checks (2026-10-24)

Added `tests/deposit-lifecycle-safety.test.ts` covering source/migration invariants: provider failure and stale DB confirmations cannot bypass chain verification; confirmation threshold precedes credit RPC; pending registration locks transaction/output identity and does not reset existing confirmation/status; conflicting owner/amount/asset/destination/output is rejected; repeat worker results recognize `ALREADY_CREDITED`; ingress does not write ledger or wallet balances. This is static/unit regression coverage, not a database-backed concurrency simulation.

Verification: focused deposit lifecycle and chain suite exit 0 (38/38 tests); `node_modules\.bin\tsc.cmd --noEmit` exit 0; `git diff --check` exit 0; migration version check exit 0 (137 files, 137 unique prefixes). Logs and exit codes are under `C:\Users\theki\paxones-audit-logs\batch35-*`.

Limitations: no real concurrent PostgreSQL transactions or live worker/provider retries were run. Migration remains local-only and unapplied; staging is empty/uninitialized and production is read-only. No SQL, commits, pushes, merges, workflow runs, or deployments occurred. Next gate is schema-matched disposable PostgreSQL rehearsal plus real duplicate/concurrent registration and worker retry integration tests.

## Batch 36 — Read-only schema compatibility preflight (2026-10-24)

- Confirmed local disposable PostgreSQL rehearsal is blocked: `docker`, `podman`, `psql`, `pg_ctl`, `initdb`, `createdb`, Supabase CLI and installed PGlite/SQL parser packages were not found. The Node `pg` client library exists but does not supply a database server. No packages were installed and no network download was attempted.
- Read-only production `information_schema` inspection confirms the target tables and migration-referenced columns exist: `deposits` and `onchain_deposits` include `output_index`; `deposits.from_address` is NOT NULL; `onchain_deposits` includes confirmation/status/address/asset/network columns; `wallets` includes `chain`, `address`, `funding_status`; `user_deposit_addresses.network` is enum `chain_network`.
- Read-only enum inspection confirms `chain_network` has `ethereum`, `bitcoin`, `ERC20`, `BEP20`, and `TRC20` labels used by the pending-registration lookup. Existing canonical unique indexes cover `(lower(tx_hash), upper(chain/network), output_index)` on both deposit tables, supporting the intended identity shape.
- Read-only inspection of the production `process_deposit_atomic` definition confirms it uses the same canonical network rules, address normalization and advisory-lock key pattern, but also confirms the existing RPC trusts `GREATEST(submitted confirmations, stored confirmations)`. The worker's independent chain-evidence threshold remains mandatory.
- Compatibility caveat: existing `deposits.asset` and `onchain_deposits.asset` columns are nullable; this migration deliberately rejects an existing row whose nullable identity fields do not match, including legacy nulls. That is fail-closed but can make a legacy pending row require manual reconciliation rather than silently reusing it.
- No SQL was executed against production or staging. No migration was applied. This batch is a read-only compatibility preflight, not a database rehearsal.

Verification / environment: schema checks were read-only metadata queries. A true disposable PostgreSQL rehearsal remains blocked until an approved local/container PostgreSQL environment is available. No production writes, staging writes, commits, pushes, merges, workflow runs or deployments occurred.

## Batch 37 — Offline migration contract regression checks (2026-10-24)

- Added `tests/deposit-registration-migration-preflight.test.ts` with checks for pinned `SECURITY DEFINER` search_path and restricted execute grants; canonical network/asset/token validation; single-owner fail-closed behavior; transaction/output identity locking and mismatch rejection; pending-only inserts and absence of direct ledger/wallet balance writes.
- Focused command: `node --import tsx --test tests/deposit-registration-migration-preflight.test.ts tests/deposit-lifecycle-safety.test.ts tests/deposit-pending-registration.test.ts` — exit 0, 13/13 passed. Log: `C:\Users\theki\paxones-audit-logs\batch37-tests.log`; exit code: `batch37-tests.exitcode` (0).
- TypeScript: `node_modules\\.bin\\tsc.cmd --noEmit` — exit 0; log/exit code `batch37-typescript.log` / `batch37-typescript.exitcode`.
- `git diff --check` — exit 0; log/exit code `batch37-diff-check.log` / `batch37-diff-check.exitcode`.
- Migration filename check: 137 migration files, 137 unique 14-digit prefixes.
- These are source/contract tests, not PostgreSQL parsing or transaction/concurrency tests. No disposable database is installed, and staging is not approved for writes, so actual SQL execution and duplicate/concurrent registration tests remain blocked. Production remains read-only; no SQL applied, no commits/pushes/merges/workflows/deployments.


## Batch 38 — LTC confirmation threshold mismatch fixed locally (2026-10-24)

- Found a concrete blocker in `supabase/migrations/20261024120000_deposit_pending_registration_hardening.sql`: LTC registration set `required_confirmations=6`, but canonical `process_deposit_atomic` migration `20261001000000_canonical_process_deposit_atomic_part6k7.sql` requires 12 and rejects existing `onchain_deposits.required_confirmations` values that differ. That mismatch could cause the credit RPC to reject LTC deposits indefinitely.
- Updated the local pending-registration migration LTC requirement from 6 to 12 to match the canonical credit RPC. No database migration was applied.
- Added a regression test in `tests/deposit-registration-migration-preflight.test.ts` asserting LTC registration and canonical credit RPC requirements match.
- Focused tests: `node --import tsx --test tests/deposit-registration-migration-preflight.test.ts tests/deposit-lifecycle-safety.test.ts tests/deposit-pending-registration.test.ts` — exit 0, 14/14 passed. Log/exit: `C:\Users\theki\paxones-audit-logs\batch38-tests.log` / `batch38-tests.exitcode`.
- TypeScript `node_modules\\.bin\\tsc.cmd --noEmit` — exit 0; `batch38-typescript.log` / `.exitcode`.
- `git diff --check` — exit 0 (existing LF/CRLF warnings only); `batch38-diff-check.log` / `.exitcode`.
- Backup: `C:\Users\theki\paxones-audit-logs\pre-batch38-deposit-migration-20261024-093949.bak`.
- Still no PostgreSQL rehearsal, no production/staging writes, no commits, pushes, merges, workflows or deployments. Source regression checks do not replace database execution.

## Batch 39 — Deposit confirmation and ledger checks (2026-10-24)

- Compared pending-registration confirmation thresholds with the canonical credit RPC: BTC 3, LTC 12, ETH 12, ERC20 12, BEP20 15, TRC20 19. All six match after Batch 38's LTC correction.
- Added source-contract regression tests for the full network threshold matrix and canonical repeat-credit ledger checks.
- Static SQL review confirms the repeat-credit path requires exactly one ledger entry for the deposit reference and validates financial identity fields. Fresh credit refuses to mutate a balance if a ledger entry already exists for that deposit reference. Runtime concurrency remains untested.
- Focused tests: `node --import tsx --test tests/deposit-registration-migration-preflight.test.ts tests/deposit-lifecycle-safety.test.ts tests/deposit-pending-registration.test.ts` — exit 0, 16/16 passed. Log: `C:\Users\theki\paxones-audit-logs\batch39-tests.log`; exit code file: `batch39-tests.exitcode`.
- TypeScript `node_modules\.bin\tsc.cmd --noEmit`: exit 0. `git diff --check`: exit 0 (existing LF/CRLF warnings only).
- No PostgreSQL integration/concurrency test was performed; migration remains unapplied. Production read-only, staging untouched, no commits/pushes/merges/workflows/deployments.

## Batch 40 — Deposit routing compatibility audit (2026-10-24)

- **Critical blocker found; no financial SQL changed.** Pending registration can resolve owners through `wallets` fallback paths for BTC, ETH, LTC, ERC20/BEP20 and TRON. The canonical `process_deposit_atomic` credit RPC resolves owners only through `user_deposit_addresses` and has no equivalent wallet fallback. A pending deposit accepted from a wallet-only address can later fail credit routing with `ADDRESS_NOT_FOUND`.
- **Network label mismatch:** read-only schema preflight found `user_deposit_addresses.network` labels include `bitcoin` and `ethereum`, not `BTC` or `ETH`; `LTC` is not a label. Canonical RPC queries `network::text = v_norm_network`, while pending registration maps BTC to `bitcoin`, ETH to `ethereum`, and uses wallet fallbacks. Thus BTC/ETH/LTC routing is not compatible end-to-end. ERC20/BEP20/TRC20 labels align, but wallet-only fallback is still incompatible.
- Treat BTC/ETH/LTC deposits as not production-safe to credit until a reviewed forward migration aligns canonical credit routing with actual registry labels and ownership rules, with ambiguity rejection and exact asset/network checks. Do not patch only the historical migration; production needs a forward migration.
- No PostgreSQL server/CLI is available locally. Staging is empty and not approved for writes; production remains read-only. No migration/data changes, commits, pushes, merges, workflows or deployments occurred.
- Backup: `C:\Users\theki\paxones-audit-logs\pre-batch40-deposit-registration-tests-20261024-094517.bak`. Batch 39 verified focused tests 16/16, TypeScript exit 0, and `git diff --check` exit 0. No new tests were run in Batch 40; this finding requires forward SQL design and PostgreSQL rehearsal.

## Batch 41 — Deployed deposit RPC reconciliation (2026-10-24)

Correction to Batch 40: read-only inspection of the deployed process_deposit_atomic function shows hybrid address routing already exists. BTC uses the bitcoin registry label then active BTC wallets; ETH uses ethereum then active EVM wallets; ERC20/BEP20 use active EVM wallets; LTC uses active LTC wallets; TRC20 uses the TRC20 registry then active TRON wallets. The function rejects ambiguous matches. The Batch 40 claim that production lacks wallet fallback was incorrect.

Added a source-contract test for pending-registration routing labels and fallback branches. Focused tests passed 17/17.

Deployed production LTC threshold is 6 confirmations; checked-in canonical and pending-registration migrations use 12. The worker checks the pending row required_confirmations before calling the credit RPC, so this should delay LTC credit rather than trigger early credit. It remains source/deployment drift needing a reviewed decision. Batch 39 compared local files only; test names now clarify that limit.

Production inspected read-only. No SQL writes or migration. Staging untouched. No commits, pushes, merges, workflows or deployments. No PostgreSQL integration test available. Backup: C:\Users\theki\paxones-audit-logs\pre-batch41-tests.bak.

## Batch 42 — Fixed confirmation threshold enforcement (2026-10-24)

Updated `src/jobs/confirmationsWorker.ts` to define the fixed threshold matrix BTC=3, LTC=12, ETH=12, ERC20=12, BEP20=15, TRC20=19. Before any provider verification or credit RPC, the worker now rejects unsupported networks and any stored `required_confirmations` that is missing or differs from the canonical threshold. It records an ERROR and skips credit for reconciliation; it does not silently override existing database rows. This intentionally blocks production LTC rows carrying the currently observed threshold 6 until they are safely reconciled.

Added two regression tests in `tests/confirmation-worker-chain-verification.test.ts` for the fixed matrix and fail-closed mismatch handling. Focused suite: 24/24 passed (exit 0). `node_modules/.bin/tsc.cmd --noEmit`: exit 0. `git diff --check`: exit 0; existing LF/CRLF warnings only. These are static/source tests, not a database integration test. Production remained read-only; staging untouched; no migration, commit, push, merge, workflow or deployment performed.

## Batch 43 — Existing deposit threshold reconciliation preflight (2026-10-24)

Read-only production queries against project `eaiwgfxoiwxepinvcykg` found `public.onchain_deposits` currently has 0 rows total, 0 PENDING rows and 0 CONFIRMED rows. Grouped queries by network/required_confirmations/status likewise returned no rows. Schema inspection confirms `required_confirmations` is an integer column but nullable; `network` and `status` are non-null. Therefore there are no existing production deposit rows to repair today, and no data-repair migration is justified for current records. The nullable threshold remains a future fail-closed case covered by worker guard/tests.

No production writes performed. Staging remains untouched and empty/uninitialized; no staging rehearsal was possible or attempted. The worker guard and tests from the previous batch remain local and uncommitted. The worktree has extensive pre-existing unrelated changes, so do not commit or push the broad working tree. This is a read-only preflight, not production validation of live deposit crediting.

## Batch 44 — Deposit credit RPC boundary audit (2026-10-24)

Read-only production inspection of `public.process_deposit_atomic(text,text,text,numeric,text,integer,bigint,text,text,integer,text)` confirms it is SECURITY DEFINER with `search_path=public, pg_temp`; `anon` and `authenticated` cannot EXECUTE it, while `service_role` and `postgres` can. The RPC independently selects a threshold by network, but it trusts `p_confirmations` and computes effective confirmations as GREATEST(caller-supplied confirmations, existing onchain_deposits.confirmations). It does not independently query/verify chain evidence. Production LTC threshold is 6, not the checked-in worker policy of 12. This remains a critical database boundary gap; no production changes were made.

Targeted local fixes: disabled `src/app/api/verify-tron-only/route.ts` with GET/POST returning HTTP 410 because the diagnostic route directly invoked the privileged credit RPC with hard-coded transaction data and caller-unverified confirmation count. Backed up original route to `C:\Users\theki\paxones-audit-logs\batch44-verify-tron-only-route.prechange.bak`. Increased BlockCypher BTC webhook minimum from 2 to 3 verified confirmations and Litecoin webhook minimum from 6 to 12. Backups: `batch44-blockcypher-route.prechange.bak`, `batch44-litecoin-route.prechange.bak`.

Added source-contract tests `tests/verify-tron-only-disabled.test.ts` and `tests/deposit-webhook-confirmation-thresholds.test.ts`. Focused test suite: 27/27 passed, exit 0. `node_modules/.bin/tsc.cmd --noEmit`: exit 0. `git diff --check`: exit 0 (line-ending warnings only). These tests do not constitute live chain or database integration testing.

Further direct credit RPC callers found in `src/app/api/internal/chain-ingest/route.ts`, `src/app/api/workers/deposit-listener/route.ts`, and other webhook/debug call sites. In particular, chain-ingest accepts caller-supplied confirmations behind a shared secret; deposit-listener has a direct credit path with a hard-coded 12 confirmations and does not independently verify token transfer receipts/logs in the inspected route. These must be migrated to pending-only registration or independently verified worker-only crediting before production approval. The checked-in pending-registration migration is not confirmed deployed, and staging remains empty/uninitialized, so no switch to that RPC was made here. No production/staging writes, migration application, commit, push, merge, workflow, or deployment.

## Batch 48 — Exact UTXO output and TRON event-index registration (2026-10-24)

### Changes made
- `src/jobs/depositIngestion.ts`: BTC and LTC ingestion now register each matching transaction output independently. Each pending record carries the amount for that exact output and its exact `vout` index. The old behavior summed multiple outputs to one address while persisting only the last index, which could never match the worker's per-output chain verification.
- TRON ingestion now rejects missing, malformed, negative, or unsafe event indexes in the JSON-RPC logs path. The TronGrid account-transfer and contract-event paths also require a persisted event index instead of silently substituting zero.
- Added `tests/deposit-ingestion-utxo-index.test.ts` with regression coverage for BTC/LTC per-output registration and strict TRON event-index handling.
- Backup created before edits: `C:\Users\theki\paxones-audit-logs\batch48-deposit-ingestion.prechange.bak`.

### Verification
- Focused deposit safety tests: 22 passed, 0 failed; exit code 0. Logs: `batch48-focused-tests-final.log`, exit code: `batch48-focused-tests-final.exitcode`.
- TypeScript check (`node_modules\.bin\tsc.cmd --noEmit`): exit code 0. Logs: `batch48-typescript-final.log`, exit code: `batch48-typescript-final.exitcode`.
- `git diff --check`: exit code 0. Logs: `batch48-diff-check-final.log`, exit code: `batch48-diff-check-final.exitcode`. Git reports line-ending warnings on existing working-copy files; no whitespace errors were reported.

### Remaining blockers and scope
- `refreshPendingDepositConfirmations()` currently calls `register_pending_deposit` and therefore does not itself credit deposits, despite its name and `newlyCredited` return field. The independent confirmation worker remains the intended credit path; consolidate or remove this duplicate recheck path only after callers and operational expectations are reviewed.
- The local `register_pending_deposit` SQL migration remains un-applied and has not been tested against an initialized isolated PostgreSQL staging schema. Production remains read-only.
- No production or staging database writes, migrations, commits, pushes, merges, or deployments were performed. Changes remain local and uncommitted.
- Paxones remains **BLOCKED for production** pending database-function trust-boundary review, schema-matched integration/rehearsal tests, remaining financial/security audit findings, and approved staging validation.


## Batch 49 — Remove misleading duplicate pending-refresh path (2026-10-24)

### Finding and correction
- `refreshPendingDepositConfirmations()` in `src/jobs/depositIngestion.ts` was documented as refreshing/crediting pending deposits, but all branches called the pending-only registration RPC and could not credit anything. The routine also contained stale BTC/LTC confirmation placeholders and a fallback output index of zero.
- Replaced it with a compatibility shim returning `{ checked: 0, newlyCredited: 0 }`. The dedicated confirmations worker remains responsible for independent chain verification and the credit RPC. The main ingestion result retains its existing `pendingRecheck` shape, but this legacy field now reports zero and should be removed from API/UI consumers in a separately reviewed compatibility change.
- Added a regression test ensuring the shim does not query providers, call registration/credit RPCs, or guess indexes.
- Backup: `C:\Users\theki\paxones-audit-logs\batch49-deposit-refresh.prechange.bak`.

### Verification
- Focused deposit safety tests: 23 passed, 0 failed; exit code 0 (`batch49-focused-tests.log`, `batch49-focused-tests.exitcode`).
- TypeScript check (`node_modules\.bin\tsc.cmd --noEmit`): exit code 0 (`batch49-typescript.log`, `batch49-typescript.exitcode`).
- `git diff --check`: exit code 0 (`batch49-diff-check.log`, `batch49-diff-check.exitcode`).

### Remaining scope
- No production or staging database changes, migration apply, commit, push, merge, or deployment occurred. All code remains local and uncommitted.
- Production remains **BLOCKED** until the database credit RPC trust boundary is independently resolved and a schema-matched isolated PostgreSQL/staging rehearsal is approved and passes. The legacy pendingRecheck response field is now a compatibility placeholder, not a count of actual chain checks.

## Batch 50 — BTC/LTC webhook credit boundary (2026-10-24)

- Updated the BlockCypher BTC and Litecoin webhook routes so they never call process_deposit_atomic.
- Both routes independently verify the specific UTXO output, then call only register_pending_deposit with p_confirmations: 0. They no longer wait for a webhook-side confirmation threshold before registering a verified output; the canonical confirmations worker remains responsible for independent threshold verification and credit attempts.
- Added regression assertions that both routes are pending-only and cannot pass provider-supplied/current confirmation counts to the credit RPC.
- Corrected a stale test assertion: depositIngestion.ts has eight pending-registration callsites, not twelve; the assertion still checks all are confirmation-zero registrations.
- Important deployment gate: register_pending_deposit is defined in the local migration 20261024120000_deposit_pending_registration_hardening.sql; it has not been confirmed deployed. Do not deploy these routes or rely on them in production until the migration is reviewed and applied in an explicitly approved environment.
- No database writes, migrations, commits, pushes, merges, or deployments were performed.
## Batch 51 — Confirmation-worker RPC response integrity (2026-10-24)

- Tightened successful credit recognition to require success=true and an exact canonical status of CREDITED or ALREADY_CREDITED. Legacy/unrecognized statuses such as CONFIRMED or lowercase credited no longer count as a successful credit.
- An RPC response without a recognized successful result now increments failedCount and emits an ERROR detail instead of silently classifying it as PENDING.
- Removed fallback to persisted block_number and from_address when independent chain verification omits those fields; nullable values are passed instead of potentially stale database metadata.
- Added regression coverage for the canonical success contract and stale metadata fallback prohibition.
- Focused tests: 28 passed, 0 failed (exit 0). TypeScript check exit 0. git diff --check exit 0.
- Logs and exit codes: C:\Users\theki\paxones-audit-logs\batch51-focused-tests.log/.exitcode, batch51-typescript.log/.exitcode, batch51-diff-check.log/.exitcode. Pre-change backups exist for worker, test files and readiness report.
- No database writes, migrations, commits, pushes, merges, or deployments were performed. Production remains blocked pending approved migration review/application and integration validation.
## Batch 52 — Confirmation-worker selection and query-failure audit (2026-10-24)

- Fixed an observability defect: a failed onchain_deposits query now increments failedCount before returning, rather than looking like a successful run with zero failures.
- Added regression tests for query failure reporting and the current selection contract.
- Critical finding: the worker selects only the oldest 50 rows with status PENDING. Rows that remain pending because of malformed indexes, threshold mismatches, unavailable chain providers, or verification mismatches can repeatedly occupy this fixed window and starve later deposits.
- Do not treat merely increasing the limit as a fix. Safe fair processing needs durable pagination/cursor semantics or an atomic database claim/lease with recovery for abandoned claims. That requires schema-matched design, concurrency tests, and an approved isolated database rehearsal; staging is currently uninitialized and production remains read-only.
- Focused verification results are recorded in batch52 logs. No database writes, migrations, commits, pushes, merges, or deployments were performed.
## Batch 53 — In-process confirmations worker concurrency guard (2026-10-24)

- Found that the worker is callable through both /api/workers/confirmations and /api/cron/confirmations (an alias), and may also be started by a 30-second interval scheduler.
- Added a process-local single-flight wrapper: concurrent calls in the same Node.js process now await the same active worker run rather than processing the selected batch concurrently.
- This is not a distributed lock. Separate server instances can still run concurrently, and the fixed oldest-50 selection can still starve later deposits. Durable database claim/lease semantics with abandoned-claim recovery remain a production blocker and need isolated schema-matched rehearsal.
- No database writes, migrations, commits, pushes, merges, or deployments were performed.
- Batch 53 verification: focused deposit/security tests 31 passed, 0 failed (exit 0); TypeScript check exit 0; direct git diff --check exit 0. Line-ending warnings are from the existing Windows Git autocrlf configuration, not whitespace errors.
- Regression test anchor was updated to reference the renamed internal execution function; no product behavior was changed to accommodate a test failure.
## Batch 54 — Fatal worker failure reporting and claim-schema audit (2026-10-24)

- Fixed the top-level fatal-exception handler in `runConfirmationsWorker`: unexpected errors now increment `failedCount` before returning, matching the pending-query error behavior from Batch 52.
- Added a regression test that asserts fatal worker exceptions cannot be returned as zero-failure runs.
- Read-only production schema inspection confirms `onchain_deposits` has no lease/claim columns and no matching pending-deposit claim RPC. Existing indexes cover canonical transaction identity and other access paths, but do not provide cross-instance coordination.
- Safe distributed claiming remains blocked pending a reviewed schema migration and isolated staging integration test. The local Supabase CLI is not installed and staging is uninitialized; no attempt was made to apply or invent a database change. Production remains read-only.
- No database writes, migrations, commits, pushes, merges, or deployments were performed.