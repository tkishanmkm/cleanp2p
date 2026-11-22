import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyTronWithdrawalEvidence } from '../src/lib/blockchain/verify-tron-withdrawal';

const txHash = 'a'.repeat(64);
const destinationAddress = 'TRecipient';
const expectedSender = 'THotWallet';
const tokenContract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const event = {
  event_name: 'Transfer', transaction_id: txHash, event_index: 0,
  block_number: 500, contract_address: tokenContract,
  result: { from: expectedSender, to: destinationAddress, value: '12500000' },
};
const base = { txHash, destinationAddress, expectedAmount: '12.5', expectedSender, blockNumber: 500, tokenContract, events: { data: [event] } };

test('accepts one exact confirmed TRC20 payout event', () => {
  assert.deepEqual(verifyTronWithdrawalEvidence(base), { verified: true, eventIndex: 0 });
});
test('rejects sender, destination, amount, contract, and block mismatches', () => {
  assert.equal(verifyTronWithdrawalEvidence({ ...base, expectedSender: 'TOther' }).verified, false);
  assert.equal(verifyTronWithdrawalEvidence({ ...base, destinationAddress: 'TOther' }).verified, false);
  assert.equal(verifyTronWithdrawalEvidence({ ...base, expectedAmount: '12.6' }).verified, false);
  assert.equal(verifyTronWithdrawalEvidence({ ...base, tokenContract: 'TWrong' }).verified, false);
  assert.equal(verifyTronWithdrawalEvidence({ ...base, blockNumber: 501 }).verified, false);
});
test('rejects missing and ambiguous event evidence', () => {
  assert.equal(verifyTronWithdrawalEvidence({ ...base, events: null }).verified, false);
  assert.equal(verifyTronWithdrawalEvidence({ ...base, events: { data: [event, event] } }).verified, false);
});
