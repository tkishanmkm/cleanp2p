import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const actionRoute = readFileSync('src/app/api/trades/[tradeId]/actions/route.ts', 'utf8');
const payRoute = readFileSync('src/app/api/p2p/trade/pay/route.ts', 'utf8');

const markPaidStart = actionRoute.indexOf("if (action === 'MARK_PAID')");
assert.ok(markPaidStart >= 0, 'canonical trade actions route must retain MARK_PAID');
const markPaidEnd = actionRoute.indexOf("if (action === 'RELEASE_ESCROW')", markPaidStart);
const markPaidHandler = actionRoute.slice(markPaidStart, markPaidEnd);
const markPaidDeadline = markPaidHandler.indexOf('const paymentDeadlineMs = trade.expires_at ? Date.parse(trade.expires_at) : Number.NaN;');
const markPaidRpc = markPaidHandler.indexOf("adminClient.rpc('mark_p2p_trade_paid'");
assert.ok(markPaidDeadline >= 0, 'MARK_PAID route must validate expires_at');
assert.ok(markPaidDeadline < markPaidRpc, 'MARK_PAID deadline check must precede the RPC');
assert.ok(markPaidHandler.includes('!Number.isFinite(paymentDeadlineMs) || paymentDeadlineMs <= Date.now()'), 'MARK_PAID must reject invalid, missing, and elapsed deadlines');
assert.ok(markPaidHandler.includes("code: 'TRADE_PAYMENT_WINDOW_EXPIRED'"), 'MARK_PAID should return a stable expiry error');

assert.ok(
  payRoute.includes("select('id,buyer_id,seller_id,status,escrow_status,expires_at')"),
  'dedicated buyer payment route must fetch expires_at',
);
const payDeadline = payRoute.indexOf('const paymentDeadlineMs = trade.expires_at ? Date.parse(trade.expires_at) : Number.NaN;');
const payRpc = payRoute.indexOf("adminClient.rpc('mark_p2p_trade_paid'");
assert.ok(payDeadline >= 0, 'dedicated buyer payment route must validate expires_at');
assert.ok(payDeadline < payRpc, 'dedicated buyer payment deadline check must precede the RPC');
assert.ok(payRoute.includes('!Number.isFinite(paymentDeadlineMs) || paymentDeadlineMs <= Date.now()'), 'dedicated buyer payment route must reject invalid, missing, and elapsed deadlines');

console.log('PASS: both buyer payment routes reject expired or missing payment deadlines before calling the service-only RPC');
console.log('NOTE: route prechecks are defense in depth; an atomic expires_at guard in mark_p2p_trade_paid is still required before production release.');
