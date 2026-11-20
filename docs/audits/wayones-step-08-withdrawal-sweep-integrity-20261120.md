# WAYONES Wallet Audit — Step 08
**Title:** Withdrawal dispatch, EVM receipts, gas-funding receipts, BTC/LTC signed-sweep recovery and finality  
**Date:** 2026-11-20  
**Repository:** `tkishanmkm/cleanp2p`  
**Supabase target:** `paxonesflows` (`eaiwgfxoiwxepinvcykg`)  
**Desktop Commander workspace:** `C:\Users\theki\cleanp2p`  
**Tier constraint:** Existing free-tier tools and resources only  
**Scope:** Withdrawal worker lease, durable broadcast identity, settlement/refund evidence, EVM nonce and gas-funding receipts, UTXO reservation/value/intent integrity, two-source conflict proofs and finality  
**Financial activity:** Read-only production catalog inspection only. No withdrawal, sweep, gas funding, nonce allocation, broadcast, balance mutation, escrow release or on-chain transaction was initiated.

## Executive status

**Step 08 is partially remediated in source control; production withdrawal and sweep flows are not ready.** The application source expects current receipt, confirmation, UTXO finality and worker-lease contracts that are not installed in `paxonesflows`. Some older RPCs and defensive triggers are present, but the exact current signatures and evidence tables are missing. This causes current workers to fail closed at important persistence/settlement boundaries; it also means production database enforcement is behind the application security model.

The repository contains 336 versioned SQL migration files while production history reports 139 entries. The gap is too large to replay with a bulk migration push. Step 08 made no production DDL changes.

## Production findings

### W08-01 — EVM withdrawal settlement and refund lack database-enforced receipt proof
**Severity: Critical — financial settlement integrity**

Production has PostgreSQL-owned SECURITY DEFINER functions:
- `complete_onchain_withdrawal(uuid,text,numeric,text)`
- `process_failed_withdrawal(uuid,text,numeric,text,boolean)`

Both are executable by `service_role`; neither is executable by `anon` or `authenticated`. Their live definitions do use an empty `search_path` and perform important controls, including locking the withdrawal row, matching the requested transaction hash, requiring a durable signed-broadcast record, checking the principal/fee/reservation, and writing ledger/mirror state atomically.

However, neither live function references `onchain_withdrawal_receipt_proofs`. The live receipt-proof table is absent. In particular:
- The completion RPC accepts a matching durable signed transaction and a supplied hash/gas amount, but does not itself verify a canonical successful EVM receipt.
- The failure/refund RPC accepts `p_is_verified_unbroadcast = true` with a recorded hash and positive gas when the withdrawal is in a broadcast-capable state, but does not itself verify a canonical failed/reverted receipt.

The current application worker does perform independent receipt verification, cross-check the signed transaction's Keccak hash, chain ID, signer and nonce, then calls `record_evm_withdrawal_receipt_proof` before calling completion/refund. That is useful application-layer defense, but the database RPC remains a privileged service-role boundary and does not enforce the same proof. A compromised or misused service-role caller could invoke the financial RPC without the intended proof. This is a database authorization/settlement integrity gap, not an anonymous or ordinary authenticated-user execution path.

The source migration `20261105190000_require_persisted_evm_withdrawal_receipts.sql` creates the private proof table, matches the proof to the durable broadcast and nonce reservation, and injects proof checks into completion, refund and broadcast-state synchronization. It is not recorded/applied in the live production schema. The worker's proof-recording RPC is also absent, so the current application cannot complete its full proof-persistence sequence against this database.

**Source follow-up:** `tests/withdrawal-receipt-proof-contract.test.ts` asserts proof identity/nonce checks, proof persistence before settlement/refund, and the database-level source migration guards. This test has not been executed.

### W08-02 — Signed BTC/LTC transaction persistence contract mismatch
**Severity: Critical — UTXO sweeper cannot persist the current intent contract**

The current `sweeperWorker.ts` sends seven arguments to `persist_signed_btc_ltc_transaction`, including `p_signed_utxo_intent`. The live database only exposes the older six-argument signature:
`(p_sweep_id uuid, p_worker_id text, p_expected_status text, p_signed_tx_hex text, p_sweep_tx_hash text, p_extend_lease_seconds integer)`.

The live `sweep_operations` table lacks `signed_utxo_intent`; `utxo_reservations` lacks `value_sat`. Current source migrations:
- `20261105120000_bind_btc_ltc_sweep_intent.sql`
- `20261105160000_bind_reserved_utxo_values.sql`

add the immutable intent contract, value binding, signed transaction persistence signature and trigger validation. They are not installed in production. As written, the current seven-argument PostgREST call cannot resolve to the live six-argument RPC. The sweeper should fail before broadcasting because it checks the persistence RPC response and throws; this is an operational halt rather than permission to broadcast without persistence. It still blocks BTC/LTC sweeping until schema and source match.

### W08-03 — Signed UTXO protection and proof-based recovery triggers are absent
**Severity: Critical — database-level signed-input protection incomplete**

Production has `trg_sync_utxo_reservation_status_from_sweep`, an AFTER status trigger. It moves reservations to SIGNED/BROADCASTED/RECOVERY_REQUIRED/CONFIRMED as the parent sweep advances. On a FAILED transition it releases only rows still in RESERVED. If the parent already has signed bytes/hash, the reservation remains held.

The live database does **not** have the intended BEFORE triggers:
- `trg_prevent_signed_utxo_sweep_failure`
- `trg_protect_signed_utxo_reservation_lifecycle`
- `trg_release_proven_conflicted_utxo_reservations`
- `trg_require_utxo_sweep_finality_before_confirmation`

The live `update_sweep_operation_status` RPC uses `search_path=public, pg_temp` and only blocks FAILED when an EVM-style nonce or EVM signed payload exists. It does not independently block a BTC/LTC signed transaction. With the present AFTER trigger, a signed UTXO can be put into a false-terminal FAILED parent state while its reservation remains locked; the observed existing trigger does not release signed reservations. That is a **stranded-recovery / false-terminal risk**, not a verified double-spend or automatic release path.

The repository source has a more complete contract:
- The first UTXO protection migration blocks automatic FAILED transitions when signed bytes or a deterministic hash exist, and prevents direct reservation deletion/release/reassignment.
- The proof-based conflict-resolution migration allows FAILED/release only after a fresh two-source proof covers every input in the immutable signed intent. Confirmation requirements are BTC 6 / LTC 12.
- The finality migration requires recent, persisted two-source block finality before a BTC/LTC sweep can become CONFIRMED.

Those tables, RPCs and triggers are not installed in production. The current worker already retains RECOVERY_REQUIRED when chain status is inconclusive and uses the proof RPCs before releasing/confirming; the missing database objects prevent that full path from completing.

### W08-04 — UTXO previous-output value binding is absent
**Severity: High — immutable signed intent cannot be checked against reserved input values**

Production `utxo_reservations` lacks `value_sat`. The current signed-intent source contract requires each input's txid, vout and independently verified previous-output value to match the active reservation set before signed bytes can be committed. Migration `20261105160000_bind_reserved_utxo_values.sql` adds this column, validates exact input count/value equality, and adds a BEFORE UPDATE trigger. It is not installed in production.

### W08-05 — EVM gas-funding receipt and nonce finality fields are absent
**Severity: Critical — hot-wallet nonce completion/recovery contract missing**

Production `gas_funding_operations` lacks `funding_receipt_status`, `funding_receipt_confirmations`, block number/hash and actual measured receipt-fee fields. The worker recovery path reads `funding_receipt_status`; the current source uses a receipt RPC which requires canonical confirmation depth before the shared hot-wallet nonce can be treated as consumed.

Source migration sequence:
- `20261104180000_record_evm_gas_funding_receipts.sql`
- `20261105210000_record_unresolved_evm_gas_funding_nonce_incidents.sql`
- `20261106112502_harden_evm_gas_funding_receipt_finality.sql`

adds fee/receipt evidence, nonce-incident tracking, receipt status constraints and the newer receipt RPC that requires confirmations (ERC20 12, BEP20 15). These source objects are not installed in production.

### W08-06 — Withdrawal confirmation scheduler and owner-token dispatch lease missing
**Severity: High — duplicate/blocked dispatch and confirmation scheduling risk**

The current source includes `src/jobs/withdrawalWorkerLease.ts`, which uses an owner-token lease and stops dispatch if renewal is lost. Production has no `withdrawal_worker_leases` table and no `acquire_withdrawal_worker_lease`, `renew_withdrawal_worker_lease`, or `release_withdrawal_worker_lease` functions. The existing regression test referenced a migration file which was untracked locally and missing from GitHub.

Added the exact source migration to this Step 08 branch:
`supabase/migrations/20261025045656_withdrawal_worker_owner_lease.sql`
It creates a singleton owner-token lease with bounded TTLs, empty search paths, and service-role/Postgres-only function execution. It was not applied remotely.

Production also lacks `schedule_withdrawal_confirmation_check` used by the latest confirmation scheduler contract; source migration `20261106121000_fence_withdrawal_confirmation_scheduler_claims.sql` adds the lease-bound scheduling field/RPC.

### W08-07 — Current worker RPC and schema mismatches
**Severity: High — current application and database are not in sync**

Read-only catalog comparison confirmed the following functions are absent from `paxonesflows`:
- `acquire_withdrawal_worker_lease`
- `renew_withdrawal_worker_lease`
- `release_withdrawal_worker_lease`
- `schedule_withdrawal_confirmation_check`
- `allocate_deposit_address_nonce`
- `record_evm_withdrawal_receipt_proof`
- `invalidate_evm_withdrawal_receipt_proof`
- `record_evm_withdrawal_nonce_incident`
- `record_evm_gas_funding_receipt`
- `record_evm_gas_funding_nonce_incident`
- `mark_evm_gas_funding_receipt_recovery_required`
- `record_utxo_sweep_finality_proof`
- `record_utxo_sweep_conflict_proofs`

A present function with an old overload is not equivalent to a current function signature: e.g. the current UTXO signed-persistence call uses a different argument list from the deployed function. The active code paths are designed to fail closed when the required RPC or proof response is unavailable.

### W08-08 — Existing defense-in-depth controls present
The live database does have several useful controls:
- `trg_guard_onchain_withdrawal_broadcast_record`: protects durable signed EVM/TRON withdrawal bytes/hash/nonce identity from mutation/deletion.
- `trg_guard_onchain_withdrawal_nonce_reservation`: protects EVM nonce reservation identity/state.
- `trg_sync_onchain_withdrawal_broadcast_state`: synchronizes broadcast/nonce-reservation status when an on-chain withdrawal changes state.
- `trg_guard_gas_funding_signed_material`: makes gas-funding signed bytes/hash immutable and rejects FAILED once signed material exists.
- `trg_sync_utxo_reservation_status_from_sweep`: preserves signed UTXO reservations across RECOVERY_REQUIRED and does not release signed reservations on FAILED.

These are not sufficient substitutes for the missing persisted receipt proofs, UTXO conflict/finality proofs, BTC/LTC signed-intent guard, or the current worker-lease contract.

## Production queue state

At the time of read-only inspection, these tables reported zero rows:
- `withdrawals`
- `onchain_withdrawals`
- `onchain_withdrawal_broadcasts`
- `onchain_withdrawal_nonce_reservations`
- `sweep_operations`
- `gas_funding_operations`
- `utxo_reservations`

No live item was modified, reserved, broadcast, released or settled.

## Step 08 source changes on this branch

- `supabase/migrations/20261025045656_withdrawal_worker_owner_lease.sql`
  - Restores the untracked source migration required by current worker and an existing test.
- `tests/withdrawal-sweep-safety-contract.test.ts`
  - Static contract assertions for owner-token lease fencing, UTXO reservation and proof lifecycle, two-source UTXO finality and signed-intent order before broadcast, EVM receipt/nonce binding, and gas-funding receipt finality.
- `tests/withdrawal-receipt-proof-contract.test.ts`
  - Static contract assertions for EVM receipt proof persistence before settlement/refund and database-side receipt/nonce proof constraints.

## Verification and safety

- Supabase target was `paxonesflows`; staging was not used.
- Read-only inspection covered functions/signatures/owners/SECURITY DEFINER/search paths/grants, table columns, triggers, policies, queue row counts and migration history.
- Reviewed the matching source migrations and current worker RPC calls.
- Added source migrations/tests only to the isolated GitHub branch.
- Automated tests were **not executed**.
- No Step 08 SQL was applied to production.
- No user balances, withdrawals, sweeps, nonces, gas funding, UTXO reservations, receipts, or ledger rows were changed.
- No blockchain transaction, merge, deployment, or paid-tier resource was used.
- Local Desktop Commander worktree was not reset, cleaned, stashed, or overwritten; existing wallet/withdrawal modifications remain untouched.

## Step 08 completion

| Item | Status |
|---|---|
| Inspect withdrawal/sweep RPCs, privileges and signatures | Complete |
| Inspect current withdrawal/sweep worker call sites | Complete |
| Identify current EVM receipt-proof gap | Complete |
| Identify UTXO signed-intent signature/schema mismatch | Complete |
| Identify missing UTXO reservation/value/proof/finality objects | Complete |
| Correct existing untracked withdrawal worker lease migration path in GitHub | Source prepared |
| Add static withdrawal/sweep safety contract tests | Source prepared; not executed |
| Install missing schema/RPC/receipt proof migrations in production | Pending migration-history reconciliation |
| Run disposable schema replay/concurrency/receipt proof tests | Pending a schema-matched free-tier or local isolated database |
| Confirm deployed app and workers are compatible | Pending; no deployment occurred |

**Step 08 is not signed off.** The highest-risk dependencies are EVM receipt-proof enforcement inside settlement/refund RPCs, UTXO signed-intent persistence and reservation-value matching, and UTXO two-source conflict/finality proof storage. The next safe step is to reconcile the migration history and schema dependency order in an isolated database—not to run a production bulk push.
