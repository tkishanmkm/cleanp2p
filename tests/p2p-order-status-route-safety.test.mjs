import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const route = readFileSync('src/app/api/p2p/orders/[id]/route.ts', 'utf8');
const releaseRoute = readFileSync('src/app/api/p2p/trades/[tradeId]/release/route.ts', 'utf8');

test('generic order status route fails closed for auth, unsupported states, and settlement', () => {
  assert.match(route, /if \(!userId\)\s*\{\s*return NextResponse\.json\(\{ error: 'Unauthorized' \}, \{ status: 401 \}\);/);
  assert.match(route, /!\['PAID', 'COMPLETED'\]\.includes\(status\)/);
  assert.match(route, /if \(status === 'COMPLETED'\)[\s\S]*?status: 409/);
  assert.doesNotMatch(route, /rpc\(['"]credit_user_balance['"]/);
  assert.match(route, /\.eq\('status', order\.status\)/);
  assert.match(route, /if \(!updatedOrder\)[\s\S]*?status: 409/);
});

test('only the order buyer may mark the order as paid', () => {
  assert.match(route, /if \(!order\.buyer_id \|\| order\.buyer_id !== userId\)/);
  assert.match(route, /Only the order buyer can mark it as paid/);
});
