import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(
  'supabase/migrations/20260928070000_canonical_p2p_state_machine_and_rpcs.sql',
  'utf8',
);
const disputeMigration = readFileSync(
  'supabase/migrations/20261003000000_p2p_dispute_schema_and_resolution_alignment.sql',
  'utf8',
);
const atomicMigration = readFileSync(
  'supabase/migrations/20261101090000_atomic_admin_dispute_settlement.sql',
  'utf8',
);
const helper = readFileSync('src/lib/admin-dispute-settlement.ts', 'utf8');
const route = readFileSync('src/app/api/admin/disputes/resolve/route.ts', 'utf8');

function body(source, name, endMarker = '$$;') {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.notEqual(start, -1, `missing function: ${name}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing function end marker for ${name}`);
  return source.slice(start, end);
}

const release = body(migration, 'release_trade_escrow', '-- 3. Authoritative cancel_p2p_trade RPC');
const cancel = body(migration, 'cancel_p2p_trade', '-- 4. Authoritative expire_p2p_trade RPC');
const resolve = body(disputeMigration, 'resolve_trade_dispute');

test('escrow release locks trade and wallet rows before financial mutations', () => {
  assert.match(release, /FROM public\.trades[\s\S]*?FOR UPDATE/);
  assert.match(release, /FROM public\.wallet_assets[\s\S]*?FOR UPDATE/);
  assert.ok(release.indexOf('FOR UPDATE') < release.indexOf('UPDATE public.wallet_assets'));
  assert.match(release, /in_escrow >= v_total_escrow/);
  assert.match(release, /Already released \(idempotent success\)/);
});

test('release records both seller escrow debit and buyer balance credit in user ledger', () => {
  assert.match(release, /'trade_rel_seller:' \|\| p_trade_id::TEXT/);
  assert.match(release, /'trade_rel_buyer:' \|\| p_trade_id::TEXT/);
  assert.match(release, /'released_escrow', v_total_escrow/);
  assert.match(release, /'credited_amount', v_trade\.crypto_amount/);
  assert.ok(release.indexOf('INSERT INTO public.ledger_entries') < release.indexOf('UPDATE public.trades'));
});

test('cancellation locks trade and escrow, refunds seller, and records a ledger entry', () => {
  assert.match(cancel, /FROM public\.trades[\s\S]*?FOR UPDATE/);
  assert.match(cancel, /FROM public\.wallet_assets[\s\S]*?FOR UPDATE/);
  assert.match(cancel, /Cannot cancel trade % while a dispute is active/);
  assert.match(cancel, /Cannot cancel trade % after payment has been marked or sent/);
  assert.match(cancel, /'trade_can:' \|\| p_trade_id::TEXT/);
  assert.match(cancel, /in_escrow >= v_total_escrow/);
});

test('canonical dispute resolver validates the administrator, participant winner, and persists winner state', () => {
  assert.match(resolve, /public\.release_trade_escrow\(v_trade\.id, v_effective_caller\)/);
  assert.match(resolve, /public\.cancel_p2p_trade\(v_trade\.id, v_effective_caller, p_resolution\)/);
  assert.match(resolve, /winner_id = p_winner_id/);
  assert.match(resolve, /v_is_buyer_winner OR v_is_seller_winner/);
});

test('admin route uses only the atomic, audited and default-off settlement path', () => {
  assert.match(atomicMigration, /admin_resolve_trade_dispute_atomic/);
  assert.match(atomicMigration, /INSERT INTO public\.admin_audit_logs/);
  assert.match(atomicMigration, /Escrow settlement did not reach the expected terminal trade state/);
  assert.match(helper, /PAXONES_ATOMIC_DISPUTE_SETTLEMENT_ENABLED !== 'true'/);
  assert.match(route, /resolveDisputeAtomically\(/);
  assert.doesNotMatch(route, /\.rpc\s*\(\s*['"](?:release_trade_escrow|cancel_p2p_trade)['"]/);
});

test('ledger and balance assertions are repository-only, not evidence of live database parity', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.release_trade_escrow/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.cancel_p2p_trade/);
  assert.match(migration, /INSERT INTO public\.ledger_entries/);
});

console.log('PASS: P2P escrow, canonical dispute and atomic admin settlement static contracts.');
