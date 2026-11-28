import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const retired = readFileSync(resolve(process.cwd(), 'src/app/api/workers/withdraw/route.ts'), 'utf8');
const canonical = readFileSync(resolve(process.cwd(), 'src/jobs/withdrawalWorker.ts'), 'utf8');

test('legacy worker endpoint authenticates then permanently refuses dispatch', () => {
  assert.match(retired, /verifyWorkerAuth/);
  assert.match(retired, /if \(!auth\.authorized\)/);
  assert.match(retired, /LEGACY_WITHDRAWAL_WORKER_DISABLED/);
  assert.match(retired, /status: 410/);
  assert.doesNotMatch(retired, /claim_pending_withdrawals|record_withdrawal_broadcast|complete_onchain_withdrawal|sendTransaction/);
});

test('canonical worker requires and forwards its per-withdrawal worker ID', () => {
  assert.match(canonical, /processWithdrawalQueue\(workerId: string = randomUUID\(\)\)/);
  assert.match(canonical, /rpc\('claim_pending_withdrawals',[\s\S]*?p_worker_id: workerId/);
  assert.match(canonical, /record_onchain_withdrawal_broadcast',[\s\S]*?p_worker_id: workerId/);
  assert.match(canonical, /processWithdrawalQueue\(workerId\)/);
});
