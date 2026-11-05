import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync('src/app/api/admin/disputes/resolve/route.ts', 'utf8');
const helper = readFileSync('src/lib/admin-dispute-settlement.ts', 'utf8');

test('admin dispute route authenticates before calling the atomic settlement boundary', () => {
  const auth = route.indexOf('verifyServerAdmin(req)');
  const supportGuard = route.indexOf('auth.supportAdmin === true');
  const settlementCall = route.indexOf('resolveDisputeAtomically({');
  assert.notEqual(auth, -1);
  assert.notEqual(supportGuard, -1);
  assert.notEqual(settlementCall, -1);
  assert.ok(auth < supportGuard && supportGuard < settlementCall);
  assert.match(route, /AdminDisputeSettlementError/);
  assert.match(route, /result\.settlementSucceeded/);
  assert.match(route, /result\.audit_logged/);
  assert.doesNotMatch(route, /rpc\(['"](?:resolve_trade_dispute|release_trade_escrow|cancel_p2p_trade)['"]/);
  assert.doesNotMatch(route, /\.from\(['"]disputes['"]\)\s*\n\s*\.update\(/);
});

test('shared server settlement helper fails closed unless the explicit release gate is enabled', () => {
  assert.match(helper, /process\.env\.PAXONES_ATOMIC_DISPUTE_SETTLEMENT_ENABLED !== 'true'/);
  assert.match(helper, /DISPUTE_ATOMIC_SETTLEMENT_UNVERIFIED/);
  assert.match(helper, /import ['"]server-only['"]/);
  assert.match(helper, /admin_resolve_trade_dispute_atomic/);
  assert.match(helper, /data\.settlement_succeeded !== true/);
  assert.match(helper, /data\.audit_logged !== true/);
});
