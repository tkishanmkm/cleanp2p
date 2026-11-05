import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const ingestion = readFileSync('src/jobs/depositIngestion.ts', 'utf8');
const worker = readFileSync('src/jobs/confirmationsWorker.ts', 'utf8');

test('USDT deposit credit allowlist is fixed and cannot be overridden by environment variables', () => {
  assert.ok(ingestion.includes("ERC20: '0xdAC17F958D2ee523a2206206994597C13D831ec7'"));
  assert.ok(ingestion.includes("BEP20: '0x55d398326f99059fF775485246999027B3197955'"));
  assert.ok(ingestion.includes("TRC20: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t'"));
  const start = ingestion.indexOf('export const CANONICAL_USDT_CONTRACTS');
  const end = ingestion.indexOf('\n});', start);
  assert.ok(start >= 0 && end > start, 'canonical allowlist declaration must exist');
  assert.ok(!ingestion.slice(start, end).includes('process.env'), 'allowlist must not accept env overrides');
  assert.ok(ingestion.slice(start, end).includes('Object.freeze('), 'allowlist should be immutable');
});

test('deposit confirmation worker consumes the same fixed contract allowlist and verifies EVM chain ID', () => {
  assert.ok(worker.includes("import { CANONICAL_USDT_CONTRACTS } from '@/jobs/depositIngestion'"));
  assert.ok(worker.includes('const tokenContract = CANONICAL_USDT_CONTRACTS[norm] || null'));
  assert.ok(worker.includes('providerNetwork.chainId !== expectedChainId'));
});
