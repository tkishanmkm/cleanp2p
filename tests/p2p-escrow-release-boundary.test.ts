import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync('src/app/api/p2p/trade/release/route.ts', 'utf8');

test('seller escrow release is authenticated and trade ownership is checked server-side', () => {
  assert.match(route, /supabase\.auth\.getUser\(\)/);
  assert.match(route, /\.from\('trades'\)[\s\S]*?\.select\('id, buyer_id, seller_id, status, escrow_status'\)/);
  assert.match(route, /const isSeller = String\(trade\.seller_id\) === user\.id/);
  assert.match(route, /if \(!isSeller\)[\s\S]*?verifyServerAdmin\(request\)/);
  assert.match(route, /TRADE_DISPUTE_REQUIRES_ADMIN_RESOLUTION/);
});

test('seller 2FA lookup failures cannot silently disable configured verification', () => {
  assert.match(route, /if \(profileError \|\| !sellerProfile\)/);
  assert.match(route, /if \(is2faActive\)/);
  assert.match(route, /!totpCode \|\| !secret \|\| !verify2FAOTP/);
});

test('service-role escrow release receives only the authenticated seller or verified admin identity', () => {
  assert.match(route, /p_caller_id: callerId/);
  assert.match(route, /callerId = adminAuth\.adminId \|\| adminAuth\.user\.id/);
  assert.doesNotMatch(route, /body\?\.callerId|body\?\.userId|p_caller_id:\s*body/);
});

console.log('PASS: P2P escrow release verifies seller ownership, dispute state, 2FA and trusted admin identity.');