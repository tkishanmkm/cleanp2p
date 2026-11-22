import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worker = readFileSync('src/jobs/withdrawalWorker.ts', 'utf8');
const hardenedRefundMigration = readFileSync(
  'supabase/migrations/20261024100000_withdrawal_refund_rpc_forward_hardening.sql',
  'utf8',
);
const productionGuardMigration = readFileSync(
  'supabase/migrations/20261026141000_fail_closed_withdrawal_refunds.sql',
  'utf8',
);

test('explicit TRON and EVM on-chain reverts use the hardened named RPC argument', () => {
  assert.equal((worker.match(/p_is_verified_revert:\s*true/g) || []).length, 2);
  assert.doesNotMatch(worker, /p_is_verified_unbroadcast\s*:/);
  assert.match(hardenedRefundMigration, /p_is_verified_revert BOOLEAN DEFAULT FALSE/i);
  assert.match(hardenedRefundMigration, /p_is_verified_unbroadcast BOOLEAN DEFAULT FALSE/i);
  assert.match(productionGuardMigration, /process_failed_withdrawal\(uuid,text,numeric,text,boolean,boolean\)/i);
});

test('verified-revert override is only sent from explicit failed chain receipt branches', () => {
  const tronFailure = worker.indexOf('} else if (success === false)');
  const evmFailure = worker.indexOf('} else if (status === 0)');
  const firstFlag = worker.indexOf('p_is_verified_revert: true');
  const secondFlag = worker.indexOf('p_is_verified_revert: true', firstFlag + 1);
  assert.ok(tronFailure >= 0 && tronFailure < firstFlag, 'TRON verified-failure branch must precede its refund override');
  assert.ok(evmFailure >= 0 && evmFailure < secondFlag, 'EVM receipt-status-zero branch must precede its refund override');
  assert.equal((worker.match(/p_is_verified_revert:/g) || []).length, 2,
    'generic/pre-broadcast/ambiguous paths must not set the verified-chain-revert flag');
});

test('hardened RPC rejects the legacy unbroadcast flag and requires persisted on-chain revert evidence', () => {
  assert.match(hardenedRefundMigration, /IF COALESCE\(p_is_verified_unbroadcast, FALSE\) THEN[\s\S]*?caller-supplied unbroadcast flag is not trusted/i);
  assert.match(hardenedRefundMigration, /IF COALESCE\(p_is_verified_revert, FALSE\) THEN[\s\S]*?verified revert requires a persisted transaction hash/i);
  assert.match(hardenedRefundMigration, /verified revert does not match a broadcast-capable withdrawal state/i);
  assert.match(hardenedRefundMigration, /paired withdrawal transaction hash mismatch/i);
});