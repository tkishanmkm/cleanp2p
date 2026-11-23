import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const migration = (name: string) => readFileSync(join(process.cwd(), 'supabase/migrations', name), 'utf8');

test('current pending registration is non-crediting and rejects spoofed confirmation counts', () => {
  const sql = migration('20261123153743_deposit_address_registry_ownership_resolution.sql');
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.register_pending_deposit'));
  assert.ok(sql.includes('p_confirmations IS DISTINCT FROM 0'));
  assert.ok(sql.includes("'PENDING'"));
  assert.ok(!sql.includes('INSERT INTO public.ledger_entries'));
  assert.ok(!sql.includes('UPDATE public.wallet_assets'));
  assert.ok(sql.includes('EXISTING_DEPOSIT_IDENTITY_MISMATCH'));
  assert.ok(sql.includes('EXISTING_ONCHAIN_IDENTITY_MISMATCH'));
  assert.ok(sql.includes('EXISTING_DEPOSIT_STATE_MISMATCH'));
  assert.ok(sql.includes('ADDRESS_CARDINALITY_CONFLICT'));
  assert.ok(sql.includes('REVOKE ALL ON FUNCTION public.register_pending_deposit'));
  assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.register_pending_deposit'));
});

test('deposit owner resolution deduplicates same-owner registry rows and rejects cross-owner conflicts', () => {
  const sql = migration('20261123153743_deposit_address_registry_ownership_resolution.sql');
  const start = sql.indexOf('-- Resolve ownership across every registered address source');
  const end = sql.indexOf('IF COALESCE(v_wallet_count, 0) > 1', start);
  assert.ok(start >= 0 && end > start);
  const block = sql.slice(start, end);
  assert.ok(block.includes('FROM public.user_deposit_addresses AS uda'));
  assert.ok(block.includes('FROM public.wallets AS w'));
  assert.ok(block.includes('FROM public.deposit_addresses AS da'));
  assert.ok(block.includes('UNION'));
  assert.ok(block.includes('SELECT COUNT(*)'));
  assert.ok(block.includes('MIN(owner_id::text)::uuid'));
});

test('pending LTC threshold matches the canonical credit RPC and worker at six confirmations', () => {
  const sql = migration('20261123153743_deposit_address_registry_ownership_resolution.sql');
  const source = readFileSync(join(process.cwd(), 'src/jobs/confirmationsWorker.ts'), 'utf8');
  assert.ok(sql.includes("WHEN 'LTC' THEN v_expected_asset := 'LTC'; v_required := 6;"));
  assert.ok(source.includes('LTC: 6'));
});

test('leased confirmation contract binds crediting to an active owner token and verified block identity', () => {
  const sql = migration('20261123153730_deposit_confirmation_contract.sql');
  for (const marker of [
    'confirmation_worker_id',
    'confirmation_lease_expires_at',
    'claim_pending_deposit_confirmations',
    'release_pending_deposit_confirmation_claim',
    'process_deposit_atomic_with_lease',
    'Active pending-deposit confirmation lease is required',
    'Verified chain payload does not match the leased pending deposit identity',
    'onchain_deposit_block_identity_check',
    'deposits_block_hash_format_check',
    'SET search_path TO pg_catalog',
    'TO service_role, postgres',
  ]) assert.ok(sql.includes(marker), marker);
});

test('post-credit integrity monitor is alert-only and does not reverse customer balances', () => {
  const sql = migration('20261123153824_deposit_chain_integrity_monitor.sql');
  assert.ok(sql.includes('CREATE TABLE IF NOT EXISTS public.deposit_chain_integrity_events'));
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.claim_deposit_integrity_checks'));
  assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.complete_deposit_integrity_check'));
  assert.ok(sql.includes('automatic_balance_reversal'));
  assert.ok(sql.includes('false'));
  assert.ok(sql.includes('ENABLE ROW LEVEL SECURITY'));
  assert.ok(sql.includes('REVOKE ALL ON TABLE public.deposit_chain_integrity_events'));
  assert.ok(!sql.includes('UPDATE public.wallet_assets'));
  assert.ok(!sql.includes('UPDATE public.user_balances'));
  assert.ok(!sql.includes('UPDATE public.wallets'));
});

test('terminal deposit replay guard validates existing ledger identity and invalid wallet balances', () => {
  const sql = migration('20261123154441_guard_terminal_deposit_registration_replay.sql');
  assert.ok(sql.includes('WALLET_ASSET_BALANCE_INVALID'));
  assert.ok(sql.includes('Scanner replay returned an existing credited deposit without changing balances'));
  assert.ok(sql.includes('Terminal ledger invariant guard:'));
  assert.ok(sql.includes('DEPOSIT_STATE_INCONSISTENT'));
  assert.ok(sql.includes('ALREADY_CREDITED'));
  assert.ok(sql.includes('search_path=pg_catalog'));
});

test('raw credit primitive is revoked from API roles while the leased wrapper remains available', () => {
  const sql = migration('20261123154456_revoke_direct_deposit_credit_rpc_execution.sql');
  assert.ok(sql.includes('public.register_pending_deposit'));
  assert.ok(sql.includes('public.process_deposit_atomic_with_lease'));
  assert.ok(sql.includes('FROM PUBLIC, anon, authenticated, service_role'));
  assert.ok(sql.includes('TO postgres'));
  assert.ok(sql.includes('Service role must retain execute access'));
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
