import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const route = readFileSync('src/app/api/verify-tron-only/route.ts', 'utf8');

test('TRON diagnostic route is disabled and cannot invoke privileged deposit crediting', () => {
  assert.match(route, /status:\s*410/);
  assert.match(route, /Diagnostic deposit-credit endpoint is disabled/);
  assert.doesNotMatch(route, /\.rpc\(['"]process_deposit_atomic['"]/);
  assert.doesNotMatch(route, /getSupabaseAdminClient|supabaseAdmin/);
});
