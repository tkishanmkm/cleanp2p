import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync('src/app/api/workers/withdraw/route.ts', 'utf8');
const canonical = readFileSync('src/app/api/cron/withdrawals/dispatch/route.ts', 'utf8');
const internalLegacy = readFileSync('src/app/api/internal/withdrawals/process/route.ts', 'utf8');
const deprecatedScheduler = readFileSync('src/jobs/scheduler.ts', 'utf8');

test('legacy worker endpoint authenticates and refuses all dispatches', () => {
  assert.match(route, /verifyWorkerAuth/);
  assert.match(route, /LEGACY_WITHDRAWAL_WORKER_DISABLED/);
  assert.match(route, /status: 410/);
  assert.doesNotMatch(route, /claim_pending_withdrawals/);
  assert.doesNotMatch(route, /sendTransaction/);
  assert.doesNotMatch(route, /record_withdrawal_broadcast/);
  assert.doesNotMatch(route, /complete_onchain_withdrawal/);
});

test('only the canonical scheduled route delegates to the withdrawal worker', () => {
  assert.match(canonical, /processPendingWithdrawals/);
  assert.match(canonical, /verifyWorkerAuth/);
});

test('internal legacy processor endpoint is authenticated and disabled without payout side effects', () => {
  assert.match(internalLegacy, /verifyWorkerAuth/);
  assert.match(internalLegacy, /LEGACY_WITHDRAWAL_PROCESSOR_DISABLED/);
  assert.match(internalLegacy, /status: 410/);
  assert.doesNotMatch(internalLegacy, /processPendingWithdrawals|signAndBroadcast|sendTransaction|complete_onchain_withdrawal/);
  assert.doesNotMatch(internalLegacy, /PROVISION_SERVICE_KEY|CHAIN_INGEST_SECRET/);
});

test('deprecated scheduler cannot invoke the unleased legacy withdrawal processor', () => {
  assert.doesNotMatch(deprecatedScheduler, /withdrawal-processor|processPendingWithdrawals/);
});
