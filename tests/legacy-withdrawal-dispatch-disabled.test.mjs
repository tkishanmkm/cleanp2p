import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync('src/app/api/withdrawals/dispatch/route.ts', 'utf8');
const canonical = readFileSync('src/app/api/cron/withdrawals/dispatch/route.ts', 'utf8');

test('legacy withdrawal endpoint is authenticated and disabled', () => {
  assert.match(route, /verifyWorkerAuth/);
  assert.match(route, /LEGACY_WITHDRAWAL_DISPATCH_DISABLED/);
  assert.match(route, /status: 410/);
  assert.doesNotMatch(route, /claim_next_pending_withdrawal/);
  assert.doesNotMatch(route, /sendTransaction/);
  assert.doesNotMatch(route, /complete_onchain_withdrawal/);
});

test('scheduled withdrawal entry point delegates to canonical worker', () => {
  assert.match(canonical, /processPendingWithdrawals/);
  assert.match(canonical, /verifyWorkerAuth/);
});
