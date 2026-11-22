import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ethers } from 'ethers';
import { resolveEvmTransferLogIndex } from '../src/lib/blockchain/resolve-evm-transfer-log-index';

const txHash = '0x' + 'a'.repeat(64);
const contract = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const destination = '0x1111111111111111111111111111111111111111';
const sender = '0x2222222222222222222222222222222222222222';
const topicAddress = (address: string) => ethers.zeroPadValue(address, 32);
const transferLog = (index: number, amount = 12_500_000n, to = destination, address = contract) => ({
  address,
  topics: [ethers.id('Transfer(address,address,uint256)'), topicAddress(sender), topicAddress(to)],
  data: ethers.toBeHex(amount, 32),
  index,
});
const receipt = { hash: txHash, status: 1, logs: [transferLog(17)] };
const base = { receipt, txHash, tokenContract: contract, destinationAddress: destination, amount: '12.5', decimals: 6 };

test('resolves the actual matching block-global log index instead of assuming zero', () => {
  assert.equal(resolveEvmTransferLogIndex(base), 17);
});

test('rejects missing, failed, or mismatched receipt evidence', () => {
  assert.equal(resolveEvmTransferLogIndex({ ...base, receipt: null }), null);
  assert.equal(resolveEvmTransferLogIndex({ ...base, receipt: { ...receipt, status: 0 } }), null);
  assert.equal(resolveEvmTransferLogIndex({ ...base, receipt: { ...receipt, hash: '0x' + 'b'.repeat(64) } }), null);
  assert.equal(resolveEvmTransferLogIndex({ ...base, receipt: { ...receipt, logs: [] } }), null);
});

test('rejects wrong recipient, token contract, amount, and malformed log index', () => {
  assert.equal(resolveEvmTransferLogIndex({ ...base, receipt: { ...receipt, logs: [transferLog(17, 12_500_000n, sender)] } }), null);
  assert.equal(resolveEvmTransferLogIndex({ ...base, receipt: { ...receipt, logs: [transferLog(17, 12_500_000n, destination, sender)] } }), null);
  assert.equal(resolveEvmTransferLogIndex({ ...base, receipt: { ...receipt, logs: [transferLog(17, 12_500_001n)] } }), null);
  assert.equal(resolveEvmTransferLogIndex({ ...base, receipt: { ...receipt, logs: [ { ...transferLog(17), index: -1 } ] } }), null);
});

test('rejects ambiguous duplicate matching Transfer logs', () => {
  assert.equal(resolveEvmTransferLogIndex({ ...base, receipt: { ...receipt, logs: [transferLog(17), transferLog(18)] } }), null);
});

test('rejects unsupported decimal precision and nonpositive amounts', () => {
  assert.equal(resolveEvmTransferLogIndex({ ...base, amount: '12.5000001' }), null);
  assert.equal(resolveEvmTransferLogIndex({ ...base, amount: '0' }), null);
});
