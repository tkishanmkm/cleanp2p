import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = process.cwd();
const migration = readFileSync(
  join(root, 'supabase/migrations/20261104130000_deposit_confirmation_contract.sql'),
  'utf8'
);
const worker = readFileSync(join(root, 'src/jobs/confirmationsWorker.ts'), 'utf8');

test('deposit confirmation migration defines bounded service-only pending claims', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS confirmation_worker_id text/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS confirmation_lease_expires_at timestamptz/i);
  assert.match(migration, /FOR UPDATE SKIP LOCKED/i);
  assert.match(migration, /least\(100, greatest\(1, coalesce\(p_limit, 10\)\)\)/i);
  assert.match(migration, /least\(900, greatest\(30, coalesce\(p_lease_seconds, 300\)\)\)/i);
  assert.match(migration, /confirmation_lease_expires_at <= pg_catalog\.clock_timestamp\(\)/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.claim_pending_deposit_confirmations/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.release_pending_deposit_confirmation_claim/i);
  assert.match(migration, /TO service_role, postgres/i);
});

test('leased credit wrapper validates pending row identity and owner token before credit', () => {
  const wrapperStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.process_deposit_atomic_with_lease');
  const wrapperEnd = migration.indexOf('REVOKE ALL ON FUNCTION public.process_deposit_atomic_with_lease', wrapperStart);
  assert.ok(wrapperStart >= 0 && wrapperEnd > wrapperStart, 'leased credit wrapper must exist');
  const wrapper = migration.slice(wrapperStart, wrapperEnd);
  assert.match(wrapper, /v_deposit\.status <> 'PENDING'/i);
  assert.match(wrapper, /confirmation_worker_id IS DISTINCT FROM p_lease_token/i);
  assert.match(wrapper, /confirmation_lease_expires_at <= pg_catalog\.clock_timestamp\(\)/i);
  assert.match(wrapper, /v_deposit\.tx_hash IS DISTINCT FROM p_tx_hash/i);
  assert.match(wrapper, /upper\(v_deposit\.network\) IS DISTINCT FROM v_network/i);
  assert.match(wrapper, /v_deposit\.output_index IS DISTINCT FROM p_output_index/i);
  assert.match(wrapper, /v_deposit\.amount IS DISTINCT FROM p_amount/i);
  assert.match(wrapper, /v_saved_address IS DISTINCT FROM v_requested_address/i);
  assert.match(wrapper, /public\.process_deposit_atomic\(/i);
  assert.match(wrapper, /block_hash = COALESCE\(block_hash, p_block_hash\)/i);
});

test('confirmation worker claims before chain verification and only calls the leased credit RPC', () => {
  assert.match(worker, /randomUUID\(\)/);
  assert.match(worker, /rpc\(\s*'claim_pending_deposit_confirmations'/);
  assert.match(worker, /rpc\(\s*'release_pending_deposit_confirmation_claim'/);
  assert.match(worker, /rpc\(\s*'process_deposit_atomic_with_lease'/);
  const claim = worker.indexOf("rpc(\n      'claim_pending_deposit_confirmations'");
  const lookup = worker.indexOf('fetchOnChainConfirmations(', worker.indexOf('async function executeConfirmationsWorker'));
  const credit = worker.indexOf("rpc('process_deposit_atomic_with_lease'");
  assert.ok(claim >= 0 && lookup > claim && credit > lookup);
  assert.match(worker, /p_owner_token: workerLeaseToken/);
  assert.match(worker, /p_lease_token: workerLeaseToken/);
  assert.match(worker, /finally\s*\{\s*await releaseDepositClaim\(deposit\.id\);/);
  assert.doesNotMatch(worker, /rpc\(['"]process_deposit_atomic['"]/);
});
