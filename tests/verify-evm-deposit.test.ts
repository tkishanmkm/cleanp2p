import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ethers } from 'ethers';
import { verifyEvmDepositEvidence } from '../src/lib/blockchain/verify-evm-deposit';
import { verifyEvmWithdrawalEvidence, ERC20_ABI } from '../src/lib/blockchain/providers';

const txHash = '0x' + 'a'.repeat(64);
const destination = '0x1111111111111111111111111111111111111111';
const sender = '0x2222222222222222222222222222222222222222';
const contract = '0xdac17f958d2ee523a2206206994597c13d831ec7';
const topicAddress = (address: string) => ethers.zeroPadValue(address, 32);
const base = {
  network: 'ERC20' as const,
  chainId: 1n,
  txHash,
  destinationAddress: destination,
  expectedAmount: '12.5',
  outputIndex: 3,
  tokenContract: contract,
  transaction: { hash: txHash, from: sender, to: contract, blockNumber: 100 },
  receipt: {
    hash: txHash, status: 1, blockNumber: 100,
    logs: [{
      address: contract,
      topics: [ethers.id('Transfer(address,address,uint256)'), topicAddress(sender), topicAddress(destination)],
      data: ethers.toBeHex(12_500_000n, 32),
      index: 3,
    }],
  },
  currentBlock: 111,
};

test('verifies exact ERC20 transfer recipient, contract, amount and log index', () => {
  assert.deepEqual(verifyEvmDepositEvidence(base), {
    confirmations: 12, blockNumber: 100, fromAddress: sender,
  });
});

test('rejects EVM deposit evidence from the wrong chain or a mismatched transaction chain ID', () => {
  assert.equal(verifyEvmDepositEvidence({ ...base, chainId: 56n }), null);
  assert.equal(verifyEvmDepositEvidence({ ...base, transaction: { ...base.transaction, chainId: 56n } }), null);
  assert.equal(verifyEvmDepositEvidence({ ...base, network: 'BEP20', chainId: 1n }), null);
});

test('rejects EVM token transaction when recipient, amount, contract, or log index differs', () => {
  assert.equal(verifyEvmDepositEvidence({
    ...base,
    receipt: { ...base.receipt, logs: [{ ...base.receipt.logs[0], topics: [base.receipt.logs[0].topics[0], topicAddress(sender), topicAddress('0x3333333333333333333333333333333333333333')] }] },
  }), null);
  assert.equal(verifyEvmDepositEvidence({
    ...base,
    receipt: { ...base.receipt, logs: [{ ...base.receipt.logs[0], data: ethers.toBeHex(12_500_001n, 32) }] },
  }), null);
  assert.equal(verifyEvmDepositEvidence({ ...base, tokenContract: '0x4444444444444444444444444444444444444444' }), null);
  assert.equal(verifyEvmDepositEvidence({ ...base, outputIndex: 4 }), null);
});

test('rejects transaction hash, failed receipt and mismatched block identity', () => {
  assert.equal(verifyEvmDepositEvidence({ ...base, transaction: { ...base.transaction, hash: '0x' + 'b'.repeat(64) } }), null);
  assert.equal(verifyEvmDepositEvidence({ ...base, receipt: { ...base.receipt, status: 0 } }), null);
  assert.equal(verifyEvmDepositEvidence({ ...base, receipt: { ...base.receipt, blockNumber: 101 } }), null);
});

test('native ETH deposits require exact recipient and wei amount', () => {
  const eth = {
    network: 'ETH' as const, chainId: 1n, txHash, destinationAddress: destination,
    expectedAmount: '0.25', outputIndex: 0,
    transaction: { hash: txHash, from: sender, to: destination, value: ethers.parseEther('0.25'), blockNumber: 100 },
    receipt: { hash: txHash, status: 1, blockNumber: 100, logs: [] },
    currentBlock: 100,
  };
  assert.equal(verifyEvmDepositEvidence(eth)?.confirmations, 1);
  assert.equal(verifyEvmDepositEvidence({ ...eth, transaction: { ...eth.transaction, value: ethers.parseEther('0.26') } }), null);
  assert.equal(verifyEvmDepositEvidence({ ...eth, transaction: { ...eth.transaction, to: sender } }), null);
});

test('EVM withdrawal evidence verifies chain, sender, token contract, exact recipient and amount', async () => {
  const iface = new ethers.Interface(ERC20_ABI);
  const encoded = iface.encodeEventLog(iface.getEvent('Transfer')!, [sender, destination, 12_500_000n]);
  const tx = { hash: txHash, chainId: 1n, from: sender, to: contract, value: 0n, data: '0xa9059cbb' };
  const receipt = { status: 1, logs: [{ address: contract, topics: encoded.topics, data: encoded.data }] };
  const provider: any = { getNetwork: async () => ({ chainId: 1n }), getTransaction: async () => tx, getTransactionReceipt: async () => receipt };
  assert.deepEqual(await verifyEvmWithdrawalEvidence({ provider, txHash, network: 'ERC20', assetSymbol: 'USDT', destinationAddress: destination, amount: '12.5', expectedSender: sender }), { verified: true, reason: 'verified_token_transfer' });
  const wrongRecipient = { ...receipt, logs: [{ ...receipt.logs[0], topics: iface.encodeEventLog(iface.getEvent('Transfer')!, [sender, '0x3333333333333333333333333333333333333333', 12_500_000n]).topics }] };
  provider.getTransactionReceipt = async () => wrongRecipient;
  assert.equal((await verifyEvmWithdrawalEvidence({ provider, txHash, network: 'ERC20', assetSymbol: 'USDT', destinationAddress: destination, amount: '12.5', expectedSender: sender })).verified, false);
  provider.getTransactionReceipt = async () => receipt;
  provider.getNetwork = async () => ({ chainId: 56n });
  assert.equal((await verifyEvmWithdrawalEvidence({ provider, txHash, network: 'ERC20', assetSymbol: 'USDT', destinationAddress: destination, amount: '12.5', expectedSender: sender })).reason, 'provider_chain_id_mismatch');
  provider.getNetwork = async () => ({ chainId: 1n });
  assert.equal((await verifyEvmWithdrawalEvidence({ provider, txHash, network: 'ERC20', assetSymbol: 'USDT', destinationAddress: destination, amount: '12.5' })).reason, 'expected_hot_wallet_unavailable');
});

test('EVM native withdrawal evidence requires exact destination and value', async () => {
  const nativeTx = { hash: txHash, chainId: 1n, from: sender, to: destination, value: ethers.parseEther('0.25'), data: '0x' };
  const provider: any = { getNetwork: async () => ({ chainId: 1n }), getTransaction: async () => nativeTx, getTransactionReceipt: async () => ({ status: 1, logs: [] }) };
  assert.equal((await verifyEvmWithdrawalEvidence({ provider, txHash, network: 'ERC20', assetSymbol: 'ETH', destinationAddress: destination, amount: '0.25', expectedSender: sender })).verified, true);
  provider.getTransaction = async () => ({ ...nativeTx, value: ethers.parseEther('0.26') });
  assert.equal((await verifyEvmWithdrawalEvidence({ provider, txHash, network: 'ERC20', assetSymbol: 'ETH', destinationAddress: destination, amount: '0.25', expectedSender: sender })).reason, 'native_transfer_mismatch');
});
