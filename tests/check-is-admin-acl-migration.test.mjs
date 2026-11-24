import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20261104202853_restrict_direct_check_is_admin_rpc_access.sql',
  'utf8',
);

test('check_is_admin direct Data API execution is revoked while trusted internal roles remain', () => {
  assert.match(migration, /REVOKE ALL PRIVILEGES\s+ON FUNCTION public\.check_is_admin\(uuid, uuid\)\s+FROM PUBLIC, anon, authenticated/i);
  assert.match(migration, /GRANT EXECUTE\s+ON FUNCTION public\.check_is_admin\(uuid, uuid\)\s+TO service_role, postgres, supabase_auth_admin/i);
  assert.match(migration, /ALTER FUNCTION public\.check_is_admin\(uuid, uuid\)\s+SET search_path = ''/i);
  assert.match(migration, /Direct authenticated\/anon RPC execution is revoked/i);
});

console.log('PASS: check_is_admin least-privilege migration contract.');
console.log('NOTE: this is a source migration contract; production ACL state must be verified separately.');
