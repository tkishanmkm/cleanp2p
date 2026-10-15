import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20261015120000_enforce_trade_account_restrictions_in_escrow.sql',
);
const sql = readFileSync(migrationPath, 'utf8');

assert.match(sql, /CREATE OR REPLACE FUNCTION public\.initiate_trade_with_escrow\(/);
assert.match(sql, /COALESCE\(p\.is_banned, FALSE\)/);
assert.match(sql, /COALESCE\(p\.is_suspended, FALSE\)/);
assert.match(sql, /COALESCE\(p\.is_on_hold, FALSE\)/);
assert.match(sql, /LOWER\(COALESCE\(p\.account_status, ''\)\) IN \('on_hold', 'suspended', 'blocked'\)/);
assert.match(sql, /LOWER\(COALESCE\(p\.status::TEXT, ''\)\) IN \('banned', 'restricted', 'suspended', 'disabled', 'deactivated'\)/);
assert.match(sql, /DETAIL = 'ACCOUNT_RESTRICTED'/);

const guardIndex = sql.indexOf('5.6 Authoritative account restrictions');
const walletMutationIndex = sql.indexOf('INSERT INTO public.wallet_assets');
assert.ok(guardIndex >= 0, 'account restriction guard must exist');
assert.ok(walletMutationIndex > guardIndex, 'restriction guard must precede wallet mutations');

console.log('Trade account restriction migration static invariants: PASS');
