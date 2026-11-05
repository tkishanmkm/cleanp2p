import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20261031140000_restore_withdrawal_idempotency_contract.sql',
  'utf8'
);
const service = readFileSync('src/lib/services/withdrawalService.ts', 'utf8');

assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.withdrawal_idempotency_keys/i);
assert.match(sql, /PRIMARY KEY \(user_id, idempotency_key\)/i);
assert.match(sql, /ENABLE ROW LEVEL SECURITY/i);
assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.withdrawal_idempotency_keys FROM PUBLIC, anon, authenticated/i);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.request_withdrawal_idempotent/i);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.lookup_withdrawal_idempotency_replay/i);
assert.match(sql, /PERFORM 1 FROM public\.profiles WHERE id = p_user_id FOR UPDATE/i);
assert.match(sql, /v_existing\.request_fingerprint IS DISTINCT FROM v_fingerprint/);
assert.match(sql, /public\.request_withdrawal\(/i);
assert.doesNotMatch(sql, /GRANT EXECUTE[^;]*TO anon|GRANT EXECUTE[^;]*TO authenticated/i);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.request_withdrawal_idempotent[\s\S]*?TO service_role, postgres/i);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.lookup_withdrawal_idempotency_replay[\s\S]*?TO service_role, postgres/i);
assert.match(service, /rpc\('lookup_withdrawal_idempotency_replay'/i);
assert.match(service, /rpc\('request_withdrawal_idempotent'/i);

console.log('PASS: canonical withdrawal reservation and exact-replay RPC contracts match the service-role application flow.');
