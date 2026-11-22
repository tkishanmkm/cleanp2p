import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync('src/app/api/jobs/blockchain-sync/route.ts', 'utf8');

test('blockchain sync cron uses shared fail-closed constant-time worker authentication', () => {
  assert.match(route, /verifyWorkerAuth/);
  assert.match(route, /allowedSecrets:\s*\[process\.env\.CRON_SECRET, process\.env\.WORKER_SECRET\]/);
  assert.match(route, /\}\)\.authorized/);
  assert.doesNotMatch(route, /if \(cronSecret && cronSecret\.trim\(\)\.length > 0\)/);
});

test('blockchain sync authenticates before deposit ingestion or withdrawal dispatch', () => {
  assert.match(route, /if \(!verifyCronAuthorization\(req\)\)\s*\{[\s\S]*?status: 401[\s\S]*?\}/);
  const authCheck = route.indexOf('if (!verifyCronAuthorization(req))');
  const deposit = route.indexOf('await runDepositIngestion()');
  const withdrawals = route.indexOf('await processAllPendingWithdrawals(10)');
  assert.ok(authCheck >= 0 && deposit > authCheck && withdrawals > authCheck);
});
