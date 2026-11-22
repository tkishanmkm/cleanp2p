import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20261030120000_add_merchant_profile_schema.sql',
  'utf8',
);
const route = readFileSync('src/app/api/user/merchant-apply/route.ts', 'utf8');

test('merchant profile migration defines constrained metadata without moving funds', () => {
  assert.match(migration, /ADD COLUMN IF NOT EXISTS merchant_tier/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS merchant_deposit_usdt/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS merchant_applied_tier/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS merchant_status/);
  assert.match(migration, /ADD COLUMN IF NOT EXISTS total_volume_usd/);
  assert.match(migration, /profiles_merchant_tier_check/);
  assert.match(migration, /profiles_merchant_status_check/);
  assert.match(migration, /RAISE EXCEPTION/);
  assert.doesNotMatch(migration, /UPDATE public\.wallet_assets/i);
  assert.doesNotMatch(migration, /INSERT INTO public\.ledger_entries/i);
});

test('merchant application remains disabled until atomic deposit accounting is available', () => {
  assert.match(route, /MERCHANT_DEPOSIT_ATOMIC_ACCOUNTING_UNAVAILABLE/);
  assert.match(route, /status:\s*503/);
  assert.doesNotMatch(route, /\.from\(['"]wallet_assets['"]\)/);
  assert.doesNotMatch(route, /\.from\(['"]ledger_entries['"]\)/);
});
