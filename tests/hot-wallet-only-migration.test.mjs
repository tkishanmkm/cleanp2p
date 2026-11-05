import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/20261028123000_enforce_hot_wallet_only.sql',
  'utf8',
);

test('hot-wallet-only migration refuses to silently rewrite existing cold-storage records', () => {
  assert.match(migration, /to_regclass\('public\.platform_wallets'\) IS NULL/i);
  assert.match(migration, /WHERE role = 'cold_storage'/i);
  assert.match(migration, /manual review is required/i);
});

test('hot-wallet-only migration removes cold-storage check and constrains allowed custody roles', () => {
  assert.match(migration, /pg_get_constraintdef\(oid\) ILIKE '%cold_storage%'/i);
  assert.match(migration, /DROP CONSTRAINT %I/i);
  assert.match(migration, /CHECK \(role IN \('hot_wallet', 'fee_collector', 'escrow_pool'\)\)/i);
  assert.doesNotMatch(migration, /'cold_storage'\s*,\s*'fee_collector'/i);
});
