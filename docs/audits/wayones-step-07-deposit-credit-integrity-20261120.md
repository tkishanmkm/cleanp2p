# WAYONES Wallet Audit — Step 07
**Title:** Deposit registration, ownership routing, confirmation leases and chain-integrity monitoring  
**Date:** 2026-11-20  
**Repository:** `tkishanmkm/cleanp2p`  
**Supabase target:** `paxonesflows` (`eaiwgfxoiwxepinvcykg`)  
**Desktop Commander workspace:** `C:\Users\theki\cleanp2p`  
**Tier constraint:** Existing free-tier resources only; no new paid services, projects, branches, scanners or runners  
**Scope:** Deposit ingestion, pending registration, independent confirmation, balance credit authorization, address ownership routing, integrity monitor  
**Financial activity:** No test deposit, customer balance change, wallet write, or blockchain transaction was initiated

## Executive result

**Step 07 is partially remediated in source control; production deposit processing is not ready.** The production schema and current application contract do not match: six RPCs called by the current scanners/workers are absent, the canonical credit primitive remains directly executable by `service_role`, and important replay/balance guards are absent. The source migrations that install these RPCs exist in the repository, but are not recorded as applied in `paxonesflows`.

A bulk migration push is unsafe. The repository contains 336 migration files while the live migration history reports 139 entries. Many historical migrations are missing from the database history even though large parts of their schema appear to exist. This step did not try to replay the entire migration directory.

## Production findings

### W07-01 — Current worker RPCs are absent from production
**Severity: Critical — deposit registration/confirmation unavailable**

Read-only catalog inspection confirmed these six public functions are absent:
- `register_pending_deposit`
- `claim_pending_deposit_confirmations`
- `release_pending_deposit_confirmation_claim`
- `process_deposit_atomic_with_lease`
- `claim_deposit_integrity_checks`
- `complete_deposit_integrity_check`

The current app calls these from `depositIngestion.ts`, `confirmationsWorker.ts`, and `depositIntegrityWorker.ts`. These are not optional convenience RPCs: the first registers pending candidates, the next two manage confirmation leases, the leased wrapper is the intended financial credit boundary, and the final two support post-credit block-integrity checks.

The source migration sequence already exists in this repository:
1. `20261104130000_deposit_confirmation_contract.sql` — adds block/lease columns and installs the pending-registration and leased-confirmation RPCs.
2. `20261107210306_guard_terminal_deposit_registration_replay.sql` — makes scanner replay idempotent, rejects a terminal deposit without a matching ledger entry, and adds wallet-balance integrity checks.
3. `20261107211754_revoke_direct_deposit_credit_rpc_execution.sql` — removes direct execution of the canonical credit primitive from `service_role` after the wrapper functions exist.
4. `20261108013000_deposit_chain_integrity_monitor.sql` — adds leased post-credit block-hash checks and durable mismatch alerts.

Read-only preflight confirmed the live `process_deposit_atomic` function exists and its source contains the anchors expected by the replay-hardening migration. It currently remains PostgreSQL-owned `SECURITY DEFINER` with `search_path=public, pg_temp`, direct `service_role` execution is true, and the following later guards are absent: `WALLET_ASSET_BALANCE_INVALID`, scanner-replay terminal guard, and terminal-ledger invariant guard.

The required confirmation/lease/block-hash columns and the integrity-event table are also absent. These migrations are required before the worker can work as written. They were **not applied** in this pass because broad migration history is out of sync; the older migration set must be reconciled before production DDL is replayed.

### W07-02 — BTC owner routing lowercases case-sensitive Bitcoin addresses
**Severity: High — potential wrong-owner resolution**

The live SQL function has exactly four matches of:
`AND LOWER(BTRIM(address)) = LOWER(v_address)`
inside the BTC branch: count/select lookups against `user_deposit_addresses` and count/select lookups against `wallets`.

Bitcoin Base58 addresses are case-sensitive. The application scanner and the independent UTXO verifier already require exact destination-address equality, but the SQL owner resolver was more permissive. A distinct address that differs only by letter case could otherwise be resolved to the wrong owner if no second case-colliding registry row existed.

Added guarded migration:
`20261120190000_step_07_case_sensitive_btc_deposit_owner_lookup.sql`

It requires the exact canonical function signature, PostgreSQL owner, `SECURITY DEFINER`, and `search_path=pg_catalog`; it then requires exactly four occurrences of the reviewed expression inside the BTC branch before replacing them with exact string comparisons. It aborts on function/schema drift. It changes no address, wallet, deposit, ledger, or balance rows. This migration is prepared on the Step 07 branch and was not applied to production.

### W07-03 — Legacy primary address rows have no current Auth owner and are not in the SQL resolver
**Severity: High — unresolved legacy address / funds-recovery risk**

Production has a legacy `deposit_addresses` registry. The app scanner monitors that table. The live `process_deposit_atomic` resolver reads `user_deposit_addresses` and `wallets`, but does **not** read `deposit_addresses`.

Read-only aggregate results:
- `deposit_addresses`: 4 active rows.
- All 4 have a non-null derivation index, network code and asset code.
- All 4 have no matching row in `auth.users`.
- `auth.users`: 0 rows; `profiles`: 0 rows.
- `user_deposit_addresses`: 0 rows; `wallets`: 0 rows.
- `deposits`, `onchain_deposits`, `wallet_assets`, and `ledger_entries`: 0 rows.

No address values or user IDs were copied into this report. These rows were not deleted, modified, reassigned, or credited. They are intentionally left unresolved: do not bind old addresses to a new user based on derivation index or guesswork. The scanner's registration RPC must reject these candidates until there is a verified owner and wallet. The ingestion patch below now exposes those RPC rejections rather than silently ignoring them.

### W07-04 — Scanner JSON rejections were silently ignored
**Severity: High — operational visibility gap**

Several scanner call sites checked only the PostgREST `error` field. The canonical RPC returns application-level rejections in JSON, for example `success:false, code:ADDRESS_NOT_FOUND`; that is not a PostgREST transport error. Those rejections were silently dropped from the per-network error list.

Source changes now:
- Centralize scanner response classification in `recordPendingDepositRegistration()`.
- Accept only `success:true` with `PENDING` or `ALREADY_CREDITED`.
- Record JSON-level rejection codes, invalid payloads, transport errors and unexpected statuses.
- Treat any scanner response claiming `credited:true` as an invariant violation; scanners are only allowed to register zero-confirmation candidates.
- Log a bounded per-network scan/error summary from the canonical background daemon. It no longer discards the `runDepositIngestion()` result.
- Log failures when the primary `deposit_addresses` registry query fails.

No balance-credit logic was added to the scanner.

### W07-05 — Confirmation migration contract test referenced a removed/nonexistent file
**Severity: Medium — stale regression test**

`tests/deposit-confirmation-worker-lease-migration.test.ts` previously loaded `20261101160000_fence_deposit_confirmation_workers.sql` and asserted obsolete column/function names. The current worker contract is defined in `20261104130000_deposit_confirmation_contract.sql` and uses `confirmation_worker_id`, `p_owner_token`, and `p_lease_token`.

The test now targets the current migration and asserts bounded claims, service-only grants, row identity checks, lease validation, and the worker's use of the fenced credit RPC.

## Step 07 source files changed on the feature branch

- `src/jobs/depositIngestion.ts`
- `supabase/migrations/20261120190000_step_07_case_sensitive_btc_deposit_owner_lookup.sql`
- `tests/deposit-ingestion-no-direct-credit.test.ts`
- `tests/deposit-confirmation-worker-lease-migration.test.ts`
- `tests/deposit-btc-address-identity-migration.test.ts`
- `docs/audits/wayones-step-07-deposit-credit-integrity-20261120.md`

## Verification and limitations

- Production project identity and health checked; the target was `paxonesflows`, not staging.
- Schema, function definitions, grants, indexes, RLS policies, row counts, registry ownership counts, and migration history were inspected using read-only SQL.
- Current worker code and SQL function signatures were compared.
- Source changes and migration preconditions were reviewed statically.
- Automated tests were **not executed** in this pass.
- No production DDL from Step 07 was applied. No customer/financial rows were changed.
- No paid-tier resource was created and no new Supabase database branch was created.
- Local Desktop Commander worktree contains pre-existing uncommitted files from other wallet/withdrawal work. It was inspected but not reset, cleaned, or overwritten.

## Step 07 completion status

| Item | Status |
|---|---|
| Identify missing worker RPCs and columns | Complete |
| Identify unsafe direct credit RPC grant and missing SQL guards | Complete |
| Prepare scanner rejection visibility fix | Code prepared |
| Prepare daemon error summary logging | Code prepared |
| Correct stale confirmation migration test | Test source updated; not executed |
| Prepare BTC exact-address resolver migration | SQL prepared; not applied |
| Confirm and preserve four orphaned legacy address rows | Complete — no ownership guesses or row changes |
| Install confirmation/lease/integrity migrations in production | Pending history reconciliation |
| Apply BTC exact-address SQL correction | Pending confirmation-contract hardening |
| Controlled positive/negative deposit integration checks | Pending a schema-matched isolated test target |
| Live deposit/credit verification | Pending; no live financial transaction allowed |

**Step 07 is not signed off.** Production deposit/confirmation processing remains blocked while the six worker RPCs/columns are absent and the canonical primitive is still directly executable by `service_role`. The next safe task is migration-history reconciliation and a schema-compatible deployment plan, not a bulk push.
