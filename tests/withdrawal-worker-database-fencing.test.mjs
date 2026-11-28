import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/20261102212707_durable_withdrawal_broadcasts.sql', 'utf8');
const worker = readFileSync('src/jobs/withdrawalWorker.ts', 'utf8');
const legacyWorker = readFileSync('src/app/api/workers/withdraw/route.ts', 'utf8');
const legacyDispatch = readFileSync('src/app/api/withdrawals/dispatch/route.ts', 'utf8');

function functionBody(name) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const end = migration.indexOf('$function$;', start);
  assert.ok(start >= 0 && end > start, `${name} must be defined in the durable withdrawal migration`);
  return migration.slice(start, end);
}

test('queue claims bind a valid worker ID to one row lease and expiration', () => {
  const claim = functionBody('claim_pending_withdrawals');
  assert.match(claim, /p_worker_id text/);
  assert.match(claim, /A valid withdrawal worker ID is required/);
  assert.match(claim, /FOR UPDATE SKIP LOCKED/);
  assert.match(claim, /worker_id = p_worker_id/);
  assert.match(claim, /lease_expires_at = pg_catalog\.clock_timestamp\(\) \+ interval '5 minutes'/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.claim_pending_withdrawals\(integer,text\)[\s\S]*?GRANT EXECUTE ON FUNCTION public\.claim_pending_withdrawals\(integer,text\)\s+TO service_role/);
});

test('normal broadcast recording validates active row and persisted-payload ownership', () => {
  const record = functionBody('record_onchain_withdrawal_broadcast');
  assert.match(record, /v_withdrawal\.worker_id IS DISTINCT FROM p_worker_id/);
  assert.match(record, /v_withdrawal\.lease_expires_at <= pg_catalog\.clock_timestamp\(\)/);
  assert.match(record, /v_payload\.worker_id IS DISTINCT FROM p_worker_id/);
  assert.match(record, /v_payload\.signed_tx IS NULL/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.record_onchain_withdrawal_broadcast\(uuid,text,text\)[\s\S]*?GRANT EXECUTE ON FUNCTION public\.record_onchain_withdrawal_broadcast\(uuid,text,text\)\s+TO service_role/);
});

test('ambiguous broadcast recovery requires the same worker and exact persisted hash', () => {
  const recover = functionBody('mark_withdrawal_ambiguous_broadcast');
  assert.match(recover, /v_withdrawal\.worker_id IS DISTINCT FROM p_worker_id/);
  assert.match(recover, /v_withdrawal\.lease_expires_at <= pg_catalog\.clock_timestamp\(\)/);
  assert.match(recover, /v_payload\.worker_id IS DISTINCT FROM p_worker_id/);
  assert.match(recover, /lower\(v_payload\.tx_hash\) IS DISTINCT FROM v_hash/);
  assert.match(recover, /status = 'RECOVERY_REQUIRED'/);
});

test('canonical worker forwards one per-withdrawal worker ID through dispatch', () => {
  assert.match(worker, /processWithdrawalQueue\(workerId: string = randomUUID\(\)\)/);
  assert.match(worker, /rpc\('claim_pending_withdrawals',[\s\S]*?p_worker_id: workerId/);
  assert.match(worker, /record_onchain_withdrawal_broadcast',[\s\S]*?p_worker_id: workerId/);
  assert.match(worker, /processWithdrawalQueue\(workerId\)/);
});

test('retired alternate endpoints cannot claim or broadcast withdrawals', () => {
  for (const route of [legacyWorker, legacyDispatch]) {
    assert.match(route, /status: 410/);
    assert.doesNotMatch(route, /claim_pending_withdrawals|claim_next_pending_withdrawal|sendTransaction|record_withdrawal_broadcast|complete_onchain_withdrawal/);
  }
});
