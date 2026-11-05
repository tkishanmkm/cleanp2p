import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261020150000_atomic_withdrawal_broadcast_state.sql'),
  'utf8',
);
const refunds = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261024100000_withdrawal_refund_rpc_forward_hardening.sql'),
  'utf8',
);

function functionBody(name) {
  const start = migration.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.ok(start >= 0, `missing ${name}`);
  const end = migration.indexOf('\n$$;', start);
  assert.ok(end > start, `could not locate end of ${name}`);
  return migration.slice(start, end);
}

test('broadcast state RPCs lock paired withdrawal before on-chain withdrawal', () => {
  for (const name of ['record_withdrawal_broadcast', 'record_ambiguous_withdrawal_broadcast']) {
    const body = functionBody(name);
    const pairedLock = body.indexOf('FROM public.withdrawals');
    const onchainLock = body.indexOf('FROM public.onchain_withdrawals');
    assert.ok(pairedLock >= 0 && onchainLock > pairedLock, `${name} must use withdrawal-then-onchain lock order`);
    assert.ok(body.indexOf('FOR UPDATE', pairedLock) < onchainLock, `${name} must lock the paired row first`);
  }
});

test('broadcast lock order matches the hardened refund RPC lock order', () => {
  const pairedLock = refunds.indexOf('FROM public.withdrawals');
  const onchainLock = refunds.indexOf('FROM public.onchain_withdrawals');
  assert.ok(pairedLock >= 0 && onchainLock > pairedLock, 'refund RPC should lock paired withdrawal first');
});
