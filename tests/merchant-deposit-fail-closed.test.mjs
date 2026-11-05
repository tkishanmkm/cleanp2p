import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync('src/app/api/user/merchant-apply/route.ts', 'utf8');

test('merchant deposit route fails closed until atomic wallet + ledger RPC exists', () => {
  assert.match(route, /supabase\.auth\.getUser\(\)/);
  assert.match(route, /MERCHANT_DEPOSIT_ATOMIC_ACCOUNTING_UNAVAILABLE/);
  assert.match(route, /status:\s*503/);
  assert.doesNotMatch(route, /getSupabaseAdminClient/);
  assert.doesNotMatch(route, /\.from\(['"]wallet_assets['"]\)/);
  assert.doesNotMatch(route, /\.from\(['"]ledger_entries['"]\)/);
  assert.doesNotMatch(route, /\.from\(['"]profiles['"]\)\s*\.update/);
});
