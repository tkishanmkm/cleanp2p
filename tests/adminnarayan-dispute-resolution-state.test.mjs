import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/app/adminnarayan/disputes/actions.ts', 'utf8');
const helper = readFileSync('src/lib/admin-dispute-settlement.ts', 'utf8');

test('admin dispute server action authenticates and delegates only to the gated atomic helper', () => {
  const auth = source.indexOf('verifyServerAdmin()');
  const supportBlock = source.indexOf('supportAdmin');
  const delegate = source.indexOf('resolveDisputeAtomically(');
  assert.ok(auth >= 0, 'server admin verification is required');
  assert.ok(supportBlock > auth, 'support-admin restriction follows authentication');
  assert.ok(delegate > supportBlock, 'settlement helper is called only after authorization');
  assert.match(helper, /PAXONES_ATOMIC_DISPUTE_SETTLEMENT_ENABLED !== 'true'/);
  assert.match(helper, /DISPUTE_ATOMIC_SETTLEMENT_UNVERIFIED/);
  assert.doesNotMatch(source, /\.rpc\s*\(\s*['"](?:release_trade_escrow|cancel_p2p_trade)['"]/);
});
