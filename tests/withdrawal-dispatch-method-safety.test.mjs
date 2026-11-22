import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const route = readFileSync(resolve(process.cwd(), 'src/app/api/withdrawals/dispatch/route.ts'), 'utf8');
const canonical = readFileSync(resolve(process.cwd(), 'src/app/api/cron/withdrawals/dispatch/route.ts'), 'utf8');

test('legacy withdrawal dispatch GET is read-only and POST is disabled', () => {
  assert.match(route, /export async function GET\(\)[\s\S]*?status: 405[\s\S]*?Allow: 'POST'/);
  assert.match(route, /verifyWorkerAuth/);
  assert.match(route, /LEGACY_WITHDRAWAL_DISPATCH_DISABLED/);
  assert.match(route, /status: 410/);
  assert.doesNotMatch(route, /claim_next_pending_withdrawal|sendTransaction|complete_onchain_withdrawal/);
});

test('scheduled withdrawal route delegates to the canonical lease-aware worker', () => {
  assert.match(canonical, /processPendingWithdrawals/);
  assert.match(canonical, /verifyWorkerAuth/);
});
