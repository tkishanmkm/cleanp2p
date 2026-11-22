import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migration = readFileSync(
  join(process.cwd(), 'supabase', 'migrations', '20261025045656_withdrawal_worker_owner_lease.sql'),
  'utf8',
);
const worker = readFileSync(
  join(process.cwd(), 'src', 'jobs', 'withdrawalWorker.ts'),
  'utf8',
);
const leaseHelper = readFileSync(
  join(process.cwd(), 'src', 'jobs', 'withdrawalWorkerLease.ts'),
  'utf8',
);

test('withdrawal lease serializes owners and expires abandoned leases', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.withdrawal_worker_leases/);
  assert.match(migration, /expires_at <= now\(\)/);
  assert.match(migration, /owner_token = EXCLUDED\.owner_token/);
  assert.match(migration, /owner_token = p_owner_token[\s\S]*expires_at > now\(\)/);
  assert.match(migration, /WHERE lease_name = 'withdrawal-dispatch'[\s\S]*AND owner_token = p_owner_token/);
  assert.match(migration, /RETURN FOUND;/);
  assert.equal((migration.match(/RETURN COALESCE\(v_owner = p_owner_token, false\);/g) || []).length, 2, 'acquire/renew must return explicit false when ownership was not returned');
});

test('lease RPCs cannot be called by client roles', () => {
  assert.ok(migration.includes('REVOKE ALL ON FUNCTION public.acquire_withdrawal_worker_lease(uuid, integer) FROM PUBLIC, anon, authenticated;'));
  assert.ok(migration.includes('REVOKE ALL ON FUNCTION public.renew_withdrawal_worker_lease(uuid, integer) FROM PUBLIC, anon, authenticated;'));
  assert.ok(migration.includes('REVOKE ALL ON FUNCTION public.release_withdrawal_worker_lease(uuid) FROM PUBLIC, anon, authenticated;'));
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.acquire_withdrawal_worker_lease\(uuid, integer\) TO service_role, postgres/);
  assert.match(migration, /SET search_path = ''/);
});

test('withdrawal worker uses lease ownership and stops claiming work if renewal is lost', () => {
  assert.match(worker, /acquireWithdrawalWorkerLease/);
  assert.match(worker, /if \(lease\.isLost\(\)\)/);
  assert.match(worker, /await lease\.stop\(\)/);
  assert.doesNotMatch(worker, /rpc\('acquire_withdrawal_worker_lock'\)/);
  assert.doesNotMatch(worker, /rpc\('release_withdrawal_worker_lock'\)/);
  assert.match(leaseHelper, /renew_withdrawal_worker_lease/);
  assert.match(leaseHelper, /release_withdrawal_worker_lease/);
  assert.match(leaseHelper, /ownerToken: string/);
  assert.match(leaseHelper, /return \{[\s\S]*ownerToken,[\s\S]*isLost:/, 'the lease owner token must be available for database fencing');
  assert.match(leaseHelper, /setInterval/);
});
