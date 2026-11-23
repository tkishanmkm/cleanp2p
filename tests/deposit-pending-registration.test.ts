import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('pending registration RPC is explicitly non-crediting and rejects spoofed confirmation counts', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261024120000_deposit_pending_registration_hardening.sql'), 'utf8');
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.register_pending_deposit'));
  assert.ok(sql.includes('p_confirmations IS DISTINCT FROM 0'));
  assert.ok(sql.includes("'PENDING'"));
  assert.ok(!sql.includes('INSERT INTO public.ledger_entries'));
  assert.ok(!sql.includes('UPDATE public.wallet_assets'));
  assert.ok(sql.includes('EXISTING_DEPOSIT_IDENTITY_MISMATCH'));
  assert.ok(sql.includes('EXISTING_ONCHAIN_IDENTITY_MISMATCH'));
  assert.ok(sql.includes('EXISTING_DEPOSIT_STATE_MISMATCH'));
  assert.ok(sql.includes('ALREADY_PROCESSED'));
  assert.ok(sql.includes('Never relabel a previously credited output as pending'));
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.register_pending_deposit'));
});

test('pending registration resolves ownership from all three registries and deduplicates the same owner', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261024120000_deposit_pending_registration_hardening.sql'), 'utf8');
  const start = sql.indexOf('-- Resolve ownership across every registered address source');
  const end = sql.indexOf('IF coalesce(v_owner_count, 0) <> 1', start);
  assert.ok(start >= 0 && end > start);
  const block = sql.slice(start, end);
  assert.ok(block.includes('FROM public.user_deposit_addresses AS uda'));
  assert.ok(block.includes('FROM public.wallets AS w'));
  assert.ok(block.includes('FROM public.deposit_addresses AS da'));
  assert.ok(block.includes('UNION'));
  assert.ok(block.includes('SELECT COUNT(*)'));
  assert.ok(sql.includes('AMBIGUOUS_ADDRESS_OWNER'));
});

test('all deposit ingress paths register pending records and do not credit directly', () => {
  for (const file of ['src/jobs/depositIngestion.ts', 'src/app/api/webhooks/deposit/route.ts', 'src/app/api/webhooks/alchemy/route.ts', 'src/app/api/wallet/deposit/route.ts']) {
    const source = readFileSync(join(process.cwd(), file), 'utf8');
    assert.ok(source.includes("rpc('register_pending_deposit'"), file);
    assert.ok(!source.includes("rpc('process_deposit_atomic'"), file);
  }
});

test('confirmation worker waits for independently verified thresholds before calling the credit RPC', () => {
  const source = readFileSync(join(process.cwd(), 'src/jobs/confirmationsWorker.ts'), 'utf8');
  const guard = source.indexOf('if (currentConfirmations < requiredConfs)');
  const credit = source.indexOf("rpc('process_deposit_atomic_with_lease'");
  assert.ok(guard >= 0 && credit > guard);
  const guarded = source.slice(guard, credit);
  assert.ok(guarded.includes('continue;'));
  assert.ok(guarded.includes('credit RPC not called'));
});
