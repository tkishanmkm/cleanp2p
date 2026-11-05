import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync('src/app/api/cron/reconcile-ledger/route.ts', 'utf8');

test('ledger reconciliation remains disabled until authoritative accounting is verified', () => {
  assert.match(route, /verifyCronAuth\(req\.headers\.get\('authorization'\)\)/);
  assert.match(route, /LEDGER_RECONCILIATION_UNAVAILABLE/);
  assert.match(route, /status:\s*503/);
  assert.doesNotMatch(route, /\.from\(['"]user_wallets['"]\)\s*\.update/);
  assert.doesNotMatch(route, /\.from\(['"]wallet_assets['"]\)\s*\.update/);
  assert.doesNotMatch(route, /LEDGER_DISCREPANCY_AUTO_FREEZE/);
});
