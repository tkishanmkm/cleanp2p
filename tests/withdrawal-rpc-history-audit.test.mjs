import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

const script = resolve('scripts/audit-withdrawal-rpc-history.mjs');
const migrations = resolve('supabase/migrations');

function inventory() {
  const result = spawnSync(process.execPath, [script, migrations], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('withdrawal RPC history audit is explicitly static and non-authoritative for deployed state', () => {
  const report = inventory();
  assert.match(report.limitation, /does not prove which migrations ran/i);
  assert.ok(report.eventCount > 0);
});

test('history inventory captures changing process_failed_withdrawal signatures', () => {
  const report = inventory();
  const signatures = new Set(report.functions.process_failed_withdrawal.map((event) => event.signature));
  assert.ok([...signatures].some((signature) => signature.includes('boolean, boolean')), 'six-argument refund signature should be visible');
  assert.ok([...signatures].some((signature) => signature.includes('boolean')), 'historical refund signature should be visible');
  assert.ok(report.functions.process_failed_withdrawal.some((event) => event.kind.startsWith('DROP FUNCTION')), 'historical overload drops should be visible');
});

test('history inventory captures old and owner-token claim/broadcast signatures', () => {
  const report = inventory();
  assert.ok(report.functions.claim_pending_withdrawals.some((event) => event.signature.includes('integer')));
  assert.ok(report.functions.claim_pending_withdrawals.some((event) => event.signature.includes('uuid, integer')));
  assert.ok(report.functions.record_withdrawal_broadcast.some((event) => event.signature.includes('uuid, text')));
  assert.ok(report.functions.record_withdrawal_broadcast.some((event) => event.signature.includes('uuid, text, uuid')));
});

test('history inventory captures idempotency RPC definitions and ACL declarations', () => {
  const report = inventory();
  assert.ok(report.functions.request_withdrawal_idempotent.some((event) => event.kind.includes('FUNCTION')));
  assert.ok(report.functions.lookup_withdrawal_idempotency_replay.some((event) => event.kind.includes('FUNCTION')));
  assert.ok(report.functions.request_withdrawal_idempotent.some((event) => event.kind === 'GRANT' || event.kind === 'REVOKE'));
});
