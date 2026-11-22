import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const source = readFileSync('src/jobs/depositIngestion.ts', 'utf8');
const tokenScanner = source.slice(source.indexOf('async function scanEvmTokenDeposits('), source.indexOf('async function scanEvmNativeDeposits('));
const nativeScanner = source.slice(source.indexOf('async function scanEvmNativeDeposits('), source.indexOf('async function scanTronDeposits('));

test('EVM token scanner validates actual RPC chain and fixed allowlisted contract before scanning', () => {
  assert.ok(tokenScanner.includes('const tokenContractAddress = CANONICAL_USDT_CONTRACTS[normNet]'));
  assert.ok(!tokenScanner.includes('chainConfig?.usdtContractAddress'));
  assert.ok(tokenScanner.includes('actualNetwork.chainId !== BigInt(chainConfig.chainId)'));
  assert.ok(tokenScanner.includes('canonicalBlockHashes.set(log.blockNumber'));
  assert.ok(tokenScanner.includes('canonicalHash !== log.blockHash.toLowerCase()'));
});

test('EVM native scanner checks provider chain and verifies native-only shortcut receipts against canonical blocks', () => {
  assert.ok(nativeScanner.includes('actualNetwork.chainId !== BigInt(chainConfig.chainId)'));
  assert.ok(nativeScanner.includes("assetSymbol !== chainConfig.nativeSymbol"));
  assert.ok(nativeScanner.includes('provider.getTransactionReceipt(txHash)'));
  assert.ok(nativeScanner.includes('receipt.blockHash.toLowerCase() !== canonicalBlock.hash.toLowerCase()'));
});
