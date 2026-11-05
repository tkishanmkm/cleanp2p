import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const worker = readFileSync(resolve(process.cwd(), 'src/jobs/withdrawalWorker.ts'), 'utf8');

test('withdrawal worker refuses chain broadcast when paired withdrawal row is missing', () => {
  assert.match(worker, /from\('withdrawals'\)[\s\S]*?\.eq\('id', withdrawal\.id\)[\s\S]*?\.maybeSingle\(\)/);
  assert.match(worker, /if \(pairedWithdrawalError \|\| !pairedWithdrawal\)[\s\S]*?PAIRED_WITHDRAWAL_RECORD_UNAVAILABLE/);
});

test('withdrawal worker refuses chain broadcast for non-dispatchable paired statuses', () => {
  assert.match(worker, /!\['queued', 'pending', 'approved', 'processing'\]\.includes\(pairedStatus\)/);
  assert.match(worker, /PAIRED_WITHDRAWAL_STATUS_NOT_DISPATCHABLE/);
  assert.ok(worker.indexOf('PAIRED_WITHDRAWAL_RECORD_UNAVAILABLE') < worker.indexOf('// BRANCH A: TRON Network'));
});
