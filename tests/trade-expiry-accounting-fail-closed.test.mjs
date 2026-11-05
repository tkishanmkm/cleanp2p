import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/app/api/trades/[tradeId]/actions/route.ts', 'utf8');
const start = source.indexOf("if (action === 'EXPIRE_TRADE')");
assert.ok(start >= 0, 'EXPIRE_TRADE handler must exist');
const end = source.indexOf("if (action ===", start + 1);
const handler = source.slice(start, end < 0 ? source.length : end);
const guard = handler.indexOf("code: 'TRADE_EXPIRY_ACCOUNTING_UNVERIFIED'");
const rpc = handler.indexOf("adminClient.rpc('expire_p2p_trade'");
assert.ok(guard >= 0, 'expiry must fail closed with a stable error code');
assert.ok(handler.includes('{ status: 503 }'), 'unverified expiry must return 503');
assert.ok(rpc < 0 || guard < rpc, 'fail-closed guard must precede expiry RPC');
console.log('PASS: trade expiry route fails closed before calling the legacy RPC');
console.log('NOTE: static contract test only; database grants and atomic accounting still require staging verification.');
