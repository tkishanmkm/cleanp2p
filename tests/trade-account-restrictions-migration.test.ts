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

const guardedRoutes = [
  'src/app/api/trades/route.ts',
  'src/app/api/trades/initiate/route.ts',
  'src/app/api/p2p/orders/create/route.ts',
  'src/app/api/p2p/trade/initiate/route.ts',
];

for (const routePath of guardedRoutes) {
  const route = readFileSync(join(process.cwd(), routePath), 'utf8');
  const rpcIndex = route.indexOf("initiate_trade_with_escrow");
  const eligibilityIndex = route.indexOf('await checkTradeEligibility(user.id)');
  assert.ok(rpcIndex >= 0, `${routePath} must call the escrow RPC`);
  assert.ok(eligibilityIndex >= 0, `${routePath} must import/use the eligibility guard`);
  assert.ok(eligibilityIndex < rpcIndex, `${routePath} must check eligibility before the escrow RPC`);
  assert.match(route, /checkTradeEligibility\(user\.id\)/, `${routePath} must check the authenticated caller`);
}

console.log('Trade account restriction migration static invariants: PASS');
