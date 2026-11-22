import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/lib/services/escrowService.ts', 'utf8');

test('server escrow helper derives caller identity from the authenticated session', () => {
  assert.match(source, /createClient,\s*getSupabaseAdminClient/);
  assert.match(source, /sessionClient\.auth\.getUser\(\)/);
  assert.match(source, /if\s*\(authError\s*\|\|\s*!user\)[\s\S]*?Authentication required/i);
  assert.match(source, /assertPlatformControlAllowed\('trade',\s*\{\s*userId:\s*user\.id\s*\}\)/);
  assert.match(source, /p_caller_id:\s*user\.id/);
});

test('server escrow helper does not accept a caller ID from function input', () => {
  assert.doesNotMatch(source, /callerId\s*:/);
  assert.doesNotMatch(source, /p_caller_id:\s*(?:input|params|options)\./);
});