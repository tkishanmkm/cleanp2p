import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const source = readFileSync(resolve(process.cwd(), 'src/jobs/reconciliationWorker.ts'), 'utf8');

test('reconciliation flags stale PROCESSING withdrawals with no transaction hash', () => {
  assert.match(source, /\.eq\('status', 'PROCESSING'\)[\s\S]*?\.is\('tx_hash', null\)[\s\S]*?\.lt\('updated_at', staleBefore\)/);
  assert.match(source, /Stale withdrawals require broadcast reconciliation/);
  assert.match(source, /threshold_minutes: 15/);
});

test('stale un-hashed withdrawals are not automatically refunded or re-queued', () => {
  const start = source.indexOf('// Stale PROCESSING rows without a tx hash');
  const end = source.indexOf('// Read canonical wallet liability and all active withdrawal totals', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const monitor = source.slice(start, end);
  assert.match(monitor, /never refund or re-queue automatically/i);
  assert.doesNotMatch(monitor, /process_failed_withdrawal|claim_pending_withdrawals|\.update\(\{\s*status:\s*'PENDING'/);
});
