import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync('src/app/api/admin/adjust-balance/route.ts', 'utf8');

test('admin balance adjustment fails closed until atomic ledger RPC is verified', () => {
  assert.match(route, /verifyServerAdmin\(req\)/);
  assert.match(route, /if\s*\(!auth\.authorized\)\s*return\s+auth\.response!/);
  assert.match(route, /ADMIN_BALANCE_ADJUSTMENT_UNAVAILABLE/);
  assert.match(route, /status:\s*503/);
  assert.doesNotMatch(route, /\.from\(["']wallet_assets["']\)/);
  assert.doesNotMatch(route, /\.from\(["']ledger_entries["']\)/);
  assert.doesNotMatch(route, /\.from\(["']wallet_transactions["']\)/);
  assert.doesNotMatch(route, /\.from\(["']admin_audit_logs["']\)/);
});
