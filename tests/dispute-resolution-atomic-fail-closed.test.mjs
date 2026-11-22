import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/lib/admin-dispute-settlement.ts', 'utf8');
const route = readFileSync('src/app/api/admin/disputes/resolve/route.ts', 'utf8');

assert.ok(source.includes("process.env.PAXONES_ATOMIC_DISPUTE_SETTLEMENT_ENABLED !== 'true'"), 'settlement must remain disabled by default');
assert.ok(source.includes("'DISPUTE_ATOMIC_SETTLEMENT_UNVERIFIED'"), 'disabled settlement must have a stable code');
assert.ok(source.includes("admin_resolve_trade_dispute_atomic"), 'enabled mode must call only the atomic audited RPC');
assert.ok(source.includes("data.settlement_succeeded !== true"), 'the helper must require database settlement confirmation');
assert.ok(source.includes("data.audit_logged !== true"), 'the helper must require database audit confirmation');
assert.ok(route.includes('verifyServerAdmin(req)'), 'admin route must verify server-side administrator authorization');
assert.ok(route.includes('auth.supportAdmin === true'), 'support administrators must remain blocked');
assert.ok(!route.includes("rpc('release_trade_escrow'"), 'route must never call the raw escrow release RPC');
assert.ok(!route.includes("rpc('cancel_p2p_trade'"), 'route must never call the raw escrow refund RPC');
console.log('PASS: dispute settlement is disabled by default and can only use the atomic, audited server RPC.');
console.log('NOTE: the database migration still requires isolated PostgreSQL replay and concurrency/financial tests.');
