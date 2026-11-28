import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync('supabase/migrations/20261028140000_withdrawal_worker_database_fencing.sql', 'utf8');
const worker = readFileSync('src/jobs/withdrawalWorker.ts', 'utf8');
const legacyWorker = readFileSync('src/app/api/workers/withdraw/route.ts', 'utf8');
const legacyDispatch = readFileSync('src/app/api/withdrawals/dispatch/route.ts', 'utf8');

test('queue claims require a live database lease token and persist it on the claimed row', () => {
  assert.match(migration, /claim_pending_withdrawals\([\s\S]*?p_owner_token uuid[\s\S]*?p_limit integer/i);
  assert.match(migration, /expires_at > now\(\)[\s\S]*?FOR SHARE/i);
  assert.match(migration, /dispatch_owner_token = p_owner_token/i);
  assert.match(migration, /FROM public\.withdrawals[\s\S]*?FOR UPDATE SKIP LOCKED[\s\S]*?FROM public\.onchain_withdrawals[\s\S]*?FOR UPDATE SKIP LOCKED/i,
    'claim must lock the paired withdrawal row before the on-chain row');
  assert.match(migration, /UPDATE public\.withdrawals[\s\S]*?SET status = 'processing'[\s\S]*?UPDATE public\.onchain_withdrawals[\s\S]*?SET status = 'PROCESSING'/i,
    'claim must transition both paired records atomically');
  assert.match(migration, /upper\(coalesce\(status, ''\)\) IN \('QUEUED', 'PENDING', 'APPROVED'\)/i,
    'claim must reject non-dispatchable paired withdrawal states');
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.claim_pending_withdrawals\(integer\)[\s\S]*?service_role/i);
});

test('normal broadcast recording checks both live lease and persisted claim owner', () => {
  assert.match(migration, /record_withdrawal_broadcast\([\s\S]*?p_owner_token uuid/i);
  assert.match(migration, /v_owner IS DISTINCT FROM p_owner_token OR v_lease_expires <= now\(\)/i);
  assert.match(migration, /v_dispatch_owner IS DISTINCT FROM p_owner_token/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.record_withdrawal_broadcast\(uuid, text\)[\s\S]*?service_role/i);
});

test('ambiguous broadcast recovery is limited to the token persisted on that withdrawal', () => {
  assert.match(migration, /record_ambiguous_withdrawal_broadcast\([\s\S]*?p_owner_token uuid\s*\)/i);
  assert.match(migration, /stale worker may have already broadcast/i);
  assert.match(migration, /v_dispatch_owner IS DISTINCT FROM p_owner_token/i);
  assert.match(migration, /terminal and cannot become ambiguous/i);
});

test('canonical worker uses per-withdrawal worker-id and expiry fencing', () => {
  assert.match(migration, /claim_pending_withdrawals\([\s\S]*?p_owner_token uuid[\s\S]*?dispatch_owner_token = p_owner_token/i);
  assert.match(worker, /processWithdrawalQueue\(workerId: string = randomUUID\(\)\)/);
  assert.match(worker, /rpc\('claim_pending_withdrawals',[\s\S]*?p_worker_id: workerId/i);
  assert.match(worker, /record_onchain_withdrawal_broadcast',[\s\S]*?p_worker_id: workerId/i);
  assert.match(worker, /claim_pending_withdrawals',[\s\S]*?p_worker_id: workerId/i);
  assert.match(migration, /v_dispatch_owner IS DISTINCT FROM p_owner_token/i);
  assert.match(worker, /processWithdrawalQueue\(workerId\)/);
});

test('retired alternate endpoints cannot claim or broadcast withdrawals', () => {
  for (const route of [legacyWorker, legacyDispatch]) {
    assert.match(route, /status: 410/);
    assert.doesNotMatch(route, /claim_pending_withdrawals|claim_next_pending_withdrawal|sendTransaction|record_withdrawal_broadcast|complete_onchain_withdrawal/);
  }
});
