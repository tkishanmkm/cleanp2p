import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = process.cwd();
const migration = readFileSync(
  join(root, 'supabase/migrations/20261101160000_fence_deposit_confirmation_workers.sql'),
  'utf8'
);
const worker = readFileSync(join(root, 'src/jobs/confirmationsWorker.ts'), 'utf8');

test('deposit confirmation lease migration defines bounded service-only claims', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS confirmation_lease_token UUID/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS confirmation_lease_expires_at TIMESTAMPTZ/i);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS confirmation_lease_attempts INTEGER/i);
  assert.match(migration, /FOR UPDATE SKIP LOCKED/i);
  assert.match(migration, /p_limit < 1 OR p_limit > 50/i);
  assert.match(migration, /p_lease_seconds < 30 OR p_lease_seconds > 900/i);
  assert.match(migration, /confirmation_lease_expires_at <= clock_timestamp\(\)/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.claim_pending_deposit_confirmations/i);
  assert.match(migration, /TO service_role, postgres/i);
});

test('leased credit wrapper validates the row identity and owner token before financial writes', () => {
  const wrapperStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.process_deposit_atomic_with_lease');
  const wrapperEnd = migration.indexOf('$function$;', wrapperStart);
  assert.ok(wrapperStart >= 0 && wrapperEnd > wrapperStart, 'leased credit wrapper must exist');
  const wrapper = migration.slice(wrapperStart, wrapperEnd);
  assert.match(wrapper, /confirmation_lease_token = p_lease_token/i);
  assert.match(wrapper, /confirmation_lease_expires_at > clock_timestamp\(\)/i);
  assert.match(wrapper, /v_deposit\.tx_hash/i);
  assert.match(wrapper, /v_deposit\.network/i);
  assert.match(wrapper, /v_deposit\.asset_symbol/i);
  assert.match(wrapper, /v_deposit\.amount/i);
  assert.match(wrapper, /v_deposit\.output_index/i);
  assert.match(wrapper, /public\.process_deposit_atomic\(/i);
  assert.match(wrapper, /RAISE EXCEPTION 'Deposit confirmation lease changed during financial processing'/i);
});

test('confirmation worker claims batches before chain lookups and uses the fenced credit RPC', () => {
  assert.match(worker, /randomUUID\(\)/);
  assert.match(worker, /rpc\(\s*'claim_pending_deposit_confirmations'/);
  assert.match(worker, /rpc\(\s*'release_pending_deposit_confirmation_claim'/);
  assert.match(worker, /rpc\(\s*'process_deposit_atomic_with_lease'/);
  const claim = worker.indexOf("rpc(\n      'claim_pending_deposit_confirmations'");
  const lookup = worker.indexOf('fetchOnChainConfirmations(', worker.indexOf('async function executeConfirmationsWorker'));
  const credit = worker.indexOf("rpc('process_deposit_atomic_with_lease'");
  assert.ok(claim >= 0 && lookup > claim && credit > lookup);
  assert.match(worker, /finally\s*\{\s*await releaseDepositClaim\(deposit\.id\);/);
});
