import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const disputeAction = readFileSync(new URL('../src/app/adminnarayan/disputes/actions.ts', import.meta.url), 'utf8');
const tradeAction = readFileSync(new URL('../src/app/adminnarayan/trades/actions.ts', import.meta.url), 'utf8');

test('admin dispute server action verifies full admin and delegates to the shared server-only settlement helper', () => {
  const auth = disputeAction.indexOf('verifyServerAdmin()');
  const supportGuard = disputeAction.indexOf('auth.supportAdmin === true');
  const helper = disputeAction.indexOf('resolveDisputeAtomically(');
  assert.notEqual(auth, -1);
  assert.notEqual(supportGuard, -1);
  assert.notEqual(helper, -1);
  assert.ok(auth < supportGuard && supportGuard < helper);
  assert.doesNotMatch(disputeAction, /rpc\(['"](?:release_trade_escrow|cancel_p2p_trade|resolve_trade_dispute)['"]/);
});

test('admin trade action binds settlement to the unique open dispute and never invokes financial RPCs directly', () => {
  const auth = tradeAction.indexOf('verifyServerAdmin()');
  const supportGuard = tradeAction.indexOf('auth.supportAdmin === true');
  const helper = tradeAction.indexOf('resolveDisputeAtomically(');
  assert.notEqual(auth, -1);
  assert.notEqual(supportGuard, -1);
  assert.notEqual(helper, -1);
  assert.ok(auth < supportGuard && supportGuard < helper);
  assert.match(tradeAction, /decision === "release" \? "RELEASE" : "CANCEL"/);
  assert.doesNotMatch(tradeAction, /rpc\(['"](?:release_trade_escrow|cancel_p2p_trade|resolve_trade_dispute)['"]/);
});
