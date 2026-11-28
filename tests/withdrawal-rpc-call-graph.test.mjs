import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

const script = resolve('scripts/audit-withdrawal-rpc-call-graph.mjs');
const root = resolve('.');

function report() {
  const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('call graph explicitly states deployed database state is not proven', () => {
  assert.match(report().limitation, /does not establish deployed PostgreSQL signatures/i);
});

test('inventory identifies admin approval and review RPC arguments', () => {
  const r = report();
  assert.ok(r.calls.some((c) => c.rpc === 'approve_withdrawal' && c.argumentKeys.includes('p_withdrawal_id') && c.argumentKeys.includes('p_admin_id')));
  assert.ok(r.calls.some((c) => c.rpc === 'reject_withdrawal_pending_approval' && c.argumentKeys.includes('p_reason')));
});

test('inventory identifies worker refund RPC named arguments', () => {
  const r = report();
  assert.ok(r.calls.some((c) => c.rpc === 'process_failed_withdrawal' && c.argumentKeys.includes('p_withdrawal_id') && c.argumentKeys.includes('p_error_reason')));
});

test('inventory captures worker-ID-fenced claim and durable broadcast calls', () => {
  const r = report();
  assert.ok(r.calls.some((c) => c.rpc === 'claim_pending_withdrawals' && c.argumentKeys.includes('p_worker_id')), 'claim RPC must forward the worker ID');
  assert.ok(r.calls.some((c) => c.rpc === 'record_onchain_withdrawal_broadcast' && c.argumentKeys.includes('p_worker_id')), 'broadcast RPC must forward the worker ID');
  assert.ok(r.calls.some((c) => c.rpc === 'mark_withdrawal_ambiguous_broadcast' && c.argumentKeys.includes('p_worker_id')), 'ambiguous recovery must forward the worker ID');
});
