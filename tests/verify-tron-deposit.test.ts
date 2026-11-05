import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyTronTransferEvent } from '../src/lib/blockchain/verify-tron-deposit';

const txHash = 'a'.repeat(64);
const destinationAddress = 'TXyz123456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const tokenContract = 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t';
const event = {
  event_name: 'Transfer', transaction_id: txHash, event_index: 2,
  block_number: 500, contract_address: tokenContract,
  result: { from: 'TFromAddress', to: destinationAddress, value: '12500000' },
};
const base = {
  txHash, destinationAddress, expectedAmount: '12.5', outputIndex: 2,
  tokenContract, blockNumber: 500, events: { data: [event] },
};

test('verifies exact TRC20 contract, destination, amount, event index and block', () => {
  assert.deepEqual(verifyTronTransferEvent(base), { fromAddress: 'TFromAddress' });
});

test('rejects mismatched or ambiguous TRC20 events', () => {
  assert.equal(verifyTronTransferEvent({ ...base, destinationAddress: 'TWrongAddress' }), null);
  assert.equal(verifyTronTransferEvent({ ...base, expectedAmount: '12.6' }), null);
  assert.equal(verifyTronTransferEvent({ ...base, tokenContract: 'TWrongContract' }), null);
  assert.equal(verifyTronTransferEvent({ ...base, outputIndex: 3 }), null);
  assert.equal(verifyTronTransferEvent({ ...base, blockNumber: 501 }), null);
  assert.equal(verifyTronTransferEvent({ ...base, events: { data: [event, event] } }), null);
});
