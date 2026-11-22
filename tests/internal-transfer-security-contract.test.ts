import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const migration = readFileSync(
  join(root, 'supabase/migrations/20261002000000_canonical_internal_transfer_and_platform_fee.sql'),
  'utf8',
);
const route = readFileSync(join(root, 'src/app/api/wallet/transfer/route.ts'), 'utf8');

test('internal transfer RPC is service-role-only in the canonical migration', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.execute_internal_transfer\s*\([\s\S]*?p_idempotency_key TEXT DEFAULT NULL/i);
  assert.match(migration, /SECURITY DEFINER[\s\S]*?SET search_path = public, pg_temp/i);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.execute_internal_transfer\(UUID, TEXT, TEXT, NUMERIC, TEXT\) FROM PUBLIC, anon, authenticated/i,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.execute_internal_transfer\(UUID, TEXT, TEXT, NUMERIC, TEXT\) TO service_role, postgres/i,
  );
});

test('internal transfer RPC binds non-service callers to the supplied sender identity', () => {
  assert.match(
    migration,
    /IF auth\.role\(\) <> 'service_role' AND auth\.uid\(\) IS NOT NULL AND auth\.uid\(\) <> p_sender_id THEN/i,
  );
  assert.match(migration, /pg_advisory_xact_lock\(hashtext\('trf:' \|\| p_sender_id::TEXT \|\| ':' \|\| v_clean_idempotency\)\)/i);
});

test('wallet transfer route derives sender from authenticated session and validates the RPC result', () => {
  assert.match(route, /supabase\.auth\.getUser\(\)/);
  assert.match(route, /p_sender_id:\s*user\.id/);
  assert.match(route, /p_idempotency_key:\s*idempotencyKey/);
  assert.match(route, /isValidTransferRpcResponse\(transferData/);
  assert.match(route, /TRANSFER_RPC_ERROR/);
});
