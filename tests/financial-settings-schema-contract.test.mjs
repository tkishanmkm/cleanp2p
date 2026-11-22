import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20261031130000_reconcile_financial_settings_contract.sql',
  'utf8'
);
const page = readFileSync('src/app/adminnarayan/settings/page.tsx', 'utf8');
const actions = readFileSync('src/app/adminnarayan/settings/actions.ts', 'utf8');
const fees = readFileSync('src/lib/fees.ts', 'utf8');

assert.match(migration, /ADD COLUMN IF NOT EXISTS withdrawal_approval_threshold_usd/i);
assert.match(migration, /ADD COLUMN IF NOT EXISTS withdrawal_fee_multiplier/i);
assert.match(migration, /INSERT INTO public\.platform_settings[\s\S]*?ON CONFLICT \(id\) DO NOTHING/i);
assert.match(migration, /INSERT INTO public\.app_settings \(key, value, updated_at\)/i);
assert.match(migration, /platform_fee_percent/);
assert.match(migration, /escrow_fee_percent/);
assert.match(migration, /min_trade_amount/);
assert.match(migration, /ON CONFLICT \(key\) DO NOTHING/i);
assert.match(page, /\.select\(['"]key, value['"]\)/i);
assert.doesNotMatch(page, /\.select\(["']platform_fee_percent, min_trade_amount["']\)/i);
assert.match(actions, /\.upsert\([\s\S]*?\{ onConflict: ["']key["'] \}/i);
assert.match(actions, /withdrawal_fee_multiplier/);
assert.match(fees, /\.select\(['"]withdrawal_fee_multiplier['"]\)/i);

console.log('PASS: financial settings schema and admin code use the deployed key/value and single-row governance contracts.');
