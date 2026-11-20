import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

const leaseMigration = read('supabase/migrations/20261025045656_withdrawal_worker_owner_lease.sql');
const withdrawalLease = read('src/jobs/withdrawalWorkerLease.ts');
const utxoProtection = read('supabase/migrations/20261105130000_protect_signed_utxo_reservations.sql');
const conflictProof = read('supabase/migrations/20261105140000_proven_utxo_conflict_resolution.sql');
const finalityProof = read('supabase/migrations/20261105150000_require_utxo_finality_proof.sql');
const utxoReservationValues = read('supabase/migrations/20261105160000_bind_reserved_utxo_values.sql');
const withdrawalReceipt = read('supabase/migrations/20261105190000_require_persisted_evm_withdrawal_receipts.sql');
const gasReceiptFinality = read('supabase/migrations/20261106112502_harden_evm_gas_funding_receipt_finality.sql');
const sweeper = read('src/jobs/sweeperWorker.ts');

test('withdrawal worker lease is PostgREST-safe, owner-token fenced and server-only', () => {
  assert.match(leaseMigration, /CREATE TABLE IF NOT EXISTS public\.withdrawal_worker_leases/);
  assert.match(leaseMigration, /lease_name = 'withdrawal-dispatch'/);
  assert.match(leaseMigration, /expires_at <= now\(\)/);
  assert.match(leaseMigration, /owner_token = p_owner_token/);
  assert.match(leaseMigration, /SET search_path = ''/);
  assert.match(leaseMigration, /REVOKE ALL ON FUNCTION public\.acquire_withdrawal_worker_lease\(uuid, integer\) FROM PUBLIC, anon, authenticated/);
  assert.match(leaseMigration, /GRANT EXECUTE ON FUNCTION public\.acquire_withdrawal_worker_lease\(uuid, integer\) TO service_role, postgres/);
  assert.match(withdrawalLease, /rpc\('acquire_withdrawal_worker_lease'/);
  assert.match(withdrawalLease, /rpc\('renew_withdrawal_worker_lease'/);
  assert.match(withdrawalLease, /rpc\('release_withdrawal_worker_lease'/);
  assert.match(withdrawalLease, /if \(error \|\| data !== true\) lost = true/);
});

test('signed BTC/LTC sweeps cannot fail or release reservations without full-input conflict proof', () => {
  assert.match(utxoProtection, /prevent_signed_utxo_sweep_failure/);
  assert.match(utxoProtection, /upper\(coalesce\(OLD\.network, ''\)\) IN \('BTC', 'LTC'\)/);
  assert.match(utxoProtection, /NEW\.status = 'FAILED'/);
  assert.match(utxoProtection, /OLD\.signed_tx_hex IS NOT NULL/);
  assert.match(utxoProtection, /trg_protect_signed_utxo_reservation_lifecycle/);

  assert.match(conflictProof, /CREATE TABLE IF NOT EXISTS public\.utxo_sweep_conflict_proofs/);
  assert.match(conflictProof, /p_proofs JSONB/);
  assert.match(conflictProof, /v_expected_count := pg_catalog\.jsonb_array_length\(v_inputs\)/);
  assert.match(conflictProof, /v_proof_count <> v_input_count/);
  assert.match(conflictProof, /pg_catalog\.lower\(v_primary_source\) = pg_catalog\.lower\(v_secondary_source\)/);
  assert.match(conflictProof, /CASE WHEN v_network = 'BTC' THEN 6 ELSE 12 END/);
  assert.match(conflictProof, /trg_release_proven_conflicted_utxo_reservations/);
  assert.match(conflictProof, /v_parent_status <> 'FAILED'/);
  assert.match(conflictProof, /complete confirmed conflict proof/);
});

test('UTXO signed intent must match reserved outpoints and verified previous-output values', () => {
  assert.match(utxoReservationValues, /ADD COLUMN IF NOT EXISTS value_sat BIGINT/);
  assert.match(utxoReservationValues, /p_signed_utxo_intent JSONB/);
  assert.match(utxoReservationValues, /v_item->>'value_sat'/);
  assert.match(utxoReservationValues, /r\.value_sat = \(i\.value->>'value_sat'\)::BIGINT/);
  assert.match(utxoReservationValues, /v_matched_count <> v_expected_count/);
  assert.match(utxoReservationValues, /trg_require_signed_utxo_values_match_reservations/);
});

test('BTC/LTC sweep confirmation requires recent two-source finality evidence', () => {
  assert.match(finalityProof, /CREATE TABLE IF NOT EXISTS public\.utxo_sweep_finality_proofs/);
  assert.match(finalityProof, /p_primary_source TEXT/);
  assert.match(finalityProof, /p_secondary_source TEXT/);
  assert.match(finalityProof, /CASE WHEN v_network = 'BTC' THEN 6 ELSE 12 END/);
  assert.match(finalityProof, /proof\.recorded_at >= pg_catalog\.clock_timestamp\(\) - INTERVAL '15 minutes'/);
  assert.match(finalityProof, /trg_require_utxo_sweep_finality_before_confirmation/);

  const persistBtc = sweeper.indexOf("rpc('persist_signed_btc_ltc_transaction'");
  const broadcastBtc = sweeper.indexOf('fetch(`${btcApiBase}/tx`', persistBtc);
  const persistLtc = sweeper.indexOf("rpc('persist_signed_btc_ltc_transaction'", persistBtc + 1);
  const broadcastLtc = sweeper.indexOf('fetch(`${ltcApiBase}/tx`', persistLtc);
  assert.ok(persistBtc >= 0 && broadcastBtc > persistBtc, 'BTC signed transaction must persist before broadcast');
  assert.ok(persistLtc > persistBtc && broadcastLtc > persistLtc, 'LTC signed transaction must persist before broadcast');
  assert.match(sweeper, /rpc\(\s*'record_utxo_sweep_finality_proof'/);
  assert.match(sweeper, /rpc\(\s*'record_utxo_sweep_conflict_proofs'/);
});

test('EVM withdrawal settlement requires persisted canonical receipt evidence and nonce binding', () => {
  assert.match(withdrawalReceipt, /CREATE TABLE IF NOT EXISTS public\.onchain_withdrawal_receipt_proofs/);
  assert.match(withdrawalReceipt, /CREATE OR REPLACE FUNCTION public\.record_evm_withdrawal_receipt_proof/);
  assert.match(withdrawalReceipt, /v_withdrawal\.nonce IS DISTINCT FROM p_transaction_nonce/);
  assert.match(withdrawalReceipt, /v_reservation\.nonce IS DISTINCT FROM p_transaction_nonce/);
  assert.match(withdrawalReceipt, /EVM completion requires a persisted canonical successful receipt proof/);
  assert.match(withdrawalReceipt, /EVM revert refund requires a persisted canonical failed receipt proof/);
  assert.match(withdrawalReceipt, /trg_sync_onchain_withdrawal_broadcast_state/);
});

test('EVM gas-funding nonce cannot be settled without a canonical finality receipt', () => {
  assert.match(gasReceiptFinality, /ADD COLUMN IF NOT EXISTS funding_receipt_status SMALLINT/);
  assert.match(gasReceiptFinality, /funding_receipt_confirmations INTEGER/);
  assert.match(gasReceiptFinality, /gas_funding_evm_confirmed_requires_receipt/);
  assert.match(gasReceiptFinality, /gas_funding_failed_nonce_requires_consumed_receipt/);
  assert.match(gasReceiptFinality, /CREATE OR REPLACE FUNCTION public\.record_evm_gas_funding_receipt/);
  assert.match(gasReceiptFinality, /p_confirmations < v_required_confirmations/);
  assert.match(gasReceiptFinality, /CREATE OR REPLACE FUNCTION public\.mark_evm_gas_funding_receipt_recovery_required/);
  assert.match(sweeper, /funding_receipt_status/);
});
