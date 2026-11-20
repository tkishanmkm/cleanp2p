import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

const receiptMigration = read('supabase/migrations/20261105190000_require_persisted_evm_withdrawal_receipts.sql');
const gasFinalityMigration = read('supabase/migrations/20261106112502_harden_evm_gas_funding_receipt_finality.sql');
const withdrawalWorker = read('src/jobs/withdrawalWorker.ts');
const sweeperWorker = read('src/jobs/sweeperWorker.ts');

test('EVM withdrawal receipt proof is bound to the durable signed transaction, signer and nonce', () => {
  assert.match(receiptMigration, /CREATE TABLE IF NOT EXISTS public\.onchain_withdrawal_receipt_proofs/);
  assert.match(receiptMigration, /CREATE OR REPLACE FUNCTION public\.record_evm_withdrawal_receipt_proof/);
  assert.match(receiptMigration, /v_withdrawal\.nonce IS DISTINCT FROM p_transaction_nonce/);
  assert.match(receiptMigration, /v_broadcast\.nonce IS DISTINCT FROM p_transaction_nonce/);
  assert.match(receiptMigration, /v_reservation\.nonce IS DISTINCT FROM p_transaction_nonce/);
  assert.match(receiptMigration, /lower\(v_reservation\.wallet_address\)/);
  assert.match(receiptMigration, /EVM withdrawal receipt does not meet the configured chain\/finality contract/);
  assert.match(receiptMigration, /EVM completion requires a persisted canonical successful receipt proof/);
  assert.match(receiptMigration, /EVM revert refund requires a persisted canonical failed receipt proof/);
  assert.match(receiptMigration, /CREATE OR REPLACE FUNCTION public\.sync_onchain_withdrawal_broadcast_state/);
});

test('withdrawal worker revalidates the persisted signed bytes before storing receipt proof', () => {
  const helperStart = withdrawalWorker.indexOf('async function persistEvmWithdrawalReceiptProof(');
  const helperEnd = withdrawalWorker.indexOf('\nasync function recordEvmWithdrawalNonceIncident', helperStart);
  assert.ok(helperStart >= 0 && helperEnd > helperStart);
  const helper = withdrawalWorker.slice(helperStart, helperEnd);
  assert.match(helper, /from\('onchain_withdrawal_broadcasts'\)/);
  assert.match(helper, /ethers\.keccak256\(signedBytes\)/);
  assert.match(helper, /parsedSignedTransaction\.nonce !== proof\.transactionNonce/);
  assert.match(helper, /parsedSignedTransaction\.chainId !== BigInt\(proof\.chainId\)/);
  assert.match(helper, /parsedSignedTransaction\.from\?\.toLowerCase\(\)/);
  assert.match(helper, /rpc\('record_evm_withdrawal_receipt_proof'/);
  assert.match(helper, /if \(error \|\| !data \|\| data\.success !== true\)/);
});

test('EVM success settlement and revert refund are ordered after proof persistence', () => {
  const successGate = withdrawalWorker.indexOf("receiptProof.receiptStatus !== 1");
  const successPersist = withdrawalWorker.indexOf('await persistEvmWithdrawalReceiptProof(w.id, receiptProof)', successGate);
  const settlement = withdrawalWorker.indexOf("rpc('complete_onchain_withdrawal'", successPersist);
  assert.ok(successGate >= 0 && successPersist > successGate && settlement > successPersist);

  const revertGate = withdrawalWorker.indexOf("receiptProof.receiptStatus !== 0");
  const revertPersist = withdrawalWorker.indexOf('await persistEvmWithdrawalReceiptProof(w.id, receiptProof)', revertGate);
  const refund = withdrawalWorker.indexOf("rpc('process_failed_withdrawal'", revertPersist);
  assert.ok(revertGate >= 0 && revertPersist > revertGate && refund > revertPersist);
});

test('EVM gas funding cannot release its shared nonce without successful receipt finality', () => {
  assert.match(gasFinalityMigration, /funding_receipt_status SMALLINT/);
  assert.match(gasFinalityMigration, /funding_receipt_block_number BIGINT/);
  assert.match(gasFinalityMigration, /funding_receipt_block_hash TEXT/);
  assert.match(gasFinalityMigration, /funding_receipt_confirmations INTEGER/);
  assert.match(gasFinalityMigration, /gas_funding_evm_confirmed_requires_receipt/);
  assert.match(gasFinalityMigration, /gas_funding_failed_nonce_requires_consumed_receipt/);
  assert.match(gasFinalityMigration, /p_confirmations < v_required_confirmations/);
  assert.match(gasFinalityMigration, /CREATE OR REPLACE FUNCTION public\.mark_evm_gas_funding_receipt_recovery_required/);
  assert.match(sweeperWorker, /rpc\(\s*'record_evm_gas_funding_receipt'/);
  assert.match(sweeperWorker, /rpc\(\s*'mark_evm_gas_funding_receipt_recovery_required'/);
});
