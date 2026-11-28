import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20261102212707_durable_withdrawal_broadcasts.sql',
  'utf8',
);
const worker = readFileSync('src/jobs/withdrawalWorker.ts', 'utf8');

test('withdrawal queue claim assigns a bounded expiring lease to one worker', () => {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.claim_pending_withdrawals(');
  const end = migration.indexOf('$function$;', start);
  assert.ok(start >= 0 && end > start);
  const claim = migration.slice(start, end);
  assert.match(claim, /p_worker_id text/);
  assert.match(claim, /A valid withdrawal worker ID is required/);
  assert.match(claim, /FOR UPDATE SKIP LOCKED/);
  assert.match(claim, /worker_id = p_worker_id/);
  assert.match(claim, /lease_expires_at = pg_catalog\.clock_timestamp\(\) \+ interval '5 minutes'/);
  assert.match(claim, /lease_expires_at IS NULL OR w\.lease_expires_at <= pg_catalog\.clock_timestamp\(\)/);
});

test('withdrawal worker fences broadcast recording by the active row lease', () => {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.record_onchain_withdrawal_broadcast(');
  const end = migration.indexOf('$function$;', start);
  assert.ok(start >= 0 && end > start);
  const recorder = migration.slice(start, end);
  assert.match(recorder, /v_withdrawal\.worker_id IS DISTINCT FROM p_worker_id/);
  assert.match(recorder, /v_withdrawal\.lease_expires_at <= pg_catalog\.clock_timestamp\(\)/);
  assert.match(recorder, /v_payload\.worker_id IS DISTINCT FROM p_worker_id/);
  assert.match(recorder, /Persisted signed withdrawal\/hash does not match the active broadcast lease/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.record_onchain_withdrawal_broadcast\(uuid,text,text\)[\s\S]*?GRANT EXECUTE ON FUNCTION public\.record_onchain_withdrawal_broadcast\(uuid,text,text\)\s+TO service_role/);
});

test('canonical worker passes one worker ID through claim and broadcast transitions', () => {
  assert.match(worker, /processWithdrawalQueue\(workerId: string = randomUUID\(\)\)/);
  assert.match(worker, /rpc\('claim_pending_withdrawals',[\s\S]*?p_worker_id: workerId/);
  assert.match(worker, /record_onchain_withdrawal_broadcast',[\s\S]*?p_worker_id: workerId/);
  assert.match(worker, /processWithdrawalQueue\(workerId\)/);
  assert.doesNotMatch(worker, /acquireWithdrawalWorkerLease/);
});
