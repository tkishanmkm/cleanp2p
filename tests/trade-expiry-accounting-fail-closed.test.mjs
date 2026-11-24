import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/app/api/trades/[tradeId]/actions/route.ts', 'utf8');
const start = source.indexOf("if (action === 'EXPIRE_TRADE')");
assert.ok(start >= 0, 'EXPIRE_TRADE handler must exist');
const end = source.indexOf("if (action ===", start + 1);
const handler = source.slice(start, end < 0 ? source.length : end);

const deadlineGuard = handler.indexOf('const expiresAtMs = trade.expires_at ? Date.parse(trade.expires_at) : Number.NaN;');
const rpc = handler.indexOf("adminClient.rpc('expire_p2p_trade'");
assert.ok(deadlineGuard >= 0, 'expiry handler must parse the authoritative payment deadline');
assert.ok(handler.includes('!Number.isFinite(expiresAtMs) || expiresAtMs > Date.now()'), 'expiry must reject missing, malformed, or future deadlines');
assert.ok(rpc > deadlineGuard, 'the server-only expiry RPC must run only after the route deadline precheck');
assert.ok(!handler.includes('TRADE_EXPIRY_ACCOUNTING_UNVERIFIED'), 'the stale unconditional 503 guard must be removed');
assert.ok(handler.includes("type: 'TRADE_EXPIRED'"), 'successful expiry should retain the system event');
console.log('PASS: trade expiry route validates the deadline before the canonical RPC');
console.log('NOTE: static contract test only; no live refund or end-to-end transaction was executed.');
