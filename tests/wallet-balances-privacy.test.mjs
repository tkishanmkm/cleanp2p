import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync('src/app/api/wallet/balances/route.ts', 'utf8');

test('wallet balances endpoint requires an authenticated session before privileged lookups', () => {
  const auth = route.indexOf('await sessionClient.auth.getUser()');
  const admin = route.indexOf('getSupabaseAdminClient()');
  assert.ok(auth >= 0 && admin > auth, 'session authentication must precede service-role database access');
  assert.match(route, /if \(authError \|\| !user\?\.id\)[\s\S]*?status: 401/);
});

test('wallet balances endpoint accepts only strict EVM addresses, preventing LIKE wildcard probing', () => {
  assert.match(route, /if \(!\/\^0x\[a-fA-F0-9\]\{40\}\$\/\.test\(address\)\)/);
  assert.match(route, /Invalid wallet address/);
});

test('wallet balances endpoint resolves address ownership and refuses cross-user or ambiguous mappings', () => {
  assert.match(route, /admin\.from\('wallets'\)[\s\S]*?admin\.from\('deposit_addresses'\)[\s\S]*?admin\.from\('user_deposit_addresses'\)/);
  assert.match(route, /if \(uniqueOwners\.length !== 1\)[\s\S]*?status: 409/);
  assert.match(route, /if \(uniqueOwners\[0\] !== user\.id\)[\s\S]*?status: 403/);
  const ownerCheck = route.indexOf('if (uniqueOwners[0] !== user.id)');
  const aggregate = route.indexOf(".from('wallet_assets')");
  assert.ok(ownerCheck >= 0 && aggregate > ownerCheck, 'address ownership check must precede canonical balance lookup');
});

test('wallet balances are sourced only from canonical wallet_assets and do not add deposit history', () => {
  assert.match(route, /\.from\('wallet_assets'\)[\s\S]*?\.select\('asset_symbol,balance'\)/);
  assert.doesNotMatch(route, /\.from\('deposits'\)/);
  assert.doesNotMatch(route, /\.from\('onchain_deposits'\)/);
});
