import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync('src/app/api/wallet/route.ts', 'utf8');

test('USDT wallet endpoint requires an authenticated user', () => {
  assert.match(route, /await supabase\.auth\.getUser\(\)/);
  assert.match(route, /if \(authErr \|\| !user\)[\s\S]*?status: 401/);
});

test('canonical available balance is not reduced by escrow a second time', () => {
  assert.match(route, /const explicitAvailable = assetRow\.available \?\? assetRow\.available_balance/);
  assert.match(route, /explicitAvailable !== null && explicitAvailable !== undefined[\s\S]*?Number\(explicitAvailable\)[\s\S]*?: Math\.max\(0, balance - lockedEscrow - lockedWithdrawal\)/);
  assert.match(route, /const explicitAvailable = userWallet\.available_balance \?\? userWallet\.available/);
  assert.match(route, /\.from\('wallets'\)[\s\S]*?\.eq\('currency', 'USDT'\)/);
});
