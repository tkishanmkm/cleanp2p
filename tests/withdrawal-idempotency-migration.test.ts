import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261024000002_withdrawal_request_idempotency.sql'),
  'utf8',
);

assert.ok(migration.includes('PRIMARY KEY (user_id, idempotency_key)'), 'idempotency keys must be unique per user');
assert.ok(migration.includes('UNIQUE (withdrawal_id)'), 'a withdrawal must not be mapped to multiple idempotency keys');
assert.ok(migration.includes('pg_advisory_xact_lock'), 'concurrent retries must serialize before reading the key map');
assert.ok(migration.includes('FOR UPDATE'), 'existing idempotency mapping must be locked while replay is checked');
assert.ok(migration.includes('v_existing.amount IS DISTINCT FROM p_amount'), 'key reuse with a changed amount must be rejected');
assert.ok(migration.includes('v_existing.network_fee IS DISTINCT FROM p_fee'), 'key reuse with a changed fee must be rejected');
assert.ok(migration.includes('v_existing.usd_equivalent IS DISTINCT FROM p_usd_equivalent'), 'key reuse with a changed USD valuation must be rejected');
assert.ok(migration.includes('usd_equivalent NUMERIC(18, 2)'), 'idempotency mapping must preserve the original USD valuation');
assert.ok(migration.includes('network_fee, usd_equivalent'), 'new mappings must persist the USD valuation');
assert.ok(migration.includes('v_existing.destination_address IS DISTINCT FROM v_address'), 'key reuse with a changed destination must be rejected');
assert.ok(migration.includes('v_existing.asset_symbol IS DISTINCT FROM v_asset'), 'key reuse with a changed asset must be rejected');
assert.ok(migration.includes('v_existing.network_code IS DISTINCT FROM v_network'), 'key reuse with a changed network must be rejected');
assert.ok(migration.includes('SECURITY DEFINER'), 'the reservation wrapper must be explicit about its privilege model');
assert.ok(migration.includes('SET search_path = public, auth, pg_temp'), 'security-definer search_path must be pinned');
assert.ok(migration.includes('FROM PUBLIC, anon, authenticated'), 'direct client execution must be revoked');
assert.ok(migration.includes('TO service_role, postgres'), 'only trusted server roles should execute the reservation RPC');
assert.ok(migration.includes('public.request_withdrawal('), 'idempotent wrapper must delegate to the canonical reservation RPC');
assert.ok(migration.includes('manual reconciliation required'), 'missing replay records must fail closed');
assert.ok(migration.includes('replayed',), 'response must identify idempotent replays');
assert.equal(
  migration.split("'success', TRUE").length - 1,
  2,
  'new reservations and idempotent replays must both return an explicit success flag',
);

console.log('Withdrawal idempotency migration source guards passed.');
