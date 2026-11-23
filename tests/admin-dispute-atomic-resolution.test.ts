import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const route = readFileSync(
  join(process.cwd(), 'src/app/api/admin/disputes/resolve/route.ts'),
  'utf8',
);
const service = readFileSync(
  join(process.cwd(), 'src/lib/admin-dispute-settlement.ts'),
  'utf8',
);
const candidateMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261108043000_restore_atomic_admin_dispute_settlement.sql'),
  'utf8',
);
const fullAdminPredicate = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261123163451_restore_active_full_admin_actor_predicate_for_atomic_dispute.sql'),
  'utf8',
);

test('admin dispute API requires full-admin verification and blocks support roles', () => {
  assert.ok(route.includes('verifyServerAdmin'));
  assert.match(route, /supportAdmin|supportReadOnly/);
  assert.ok(route.includes('resolveDisputeAtomically'));
});

test('admin dispute service fails closed until the atomic database contract is enabled', () => {
  assert.ok(service.includes('PAXONES_ATOMIC_DISPUTE_SETTLEMENT_ENABLED'));
  assert.ok(service.includes('admin_resolve_trade_dispute_atomic'));
  assert.ok(service.includes('DISPUTE_ATOMIC_SETTLEMENT_UNVERIFIED'));
  assert.doesNotMatch(service, /\.rpc\(['"]release_trade_escrow/);
  assert.doesNotMatch(service, /\.rpc\(['"]cancel_p2p_trade/);
});

test('atomic dispute migration requires a verified full administrator and immutable audit row', () => {
  assert.ok(candidateMigration.includes('public.admin_resolve_trade_dispute_atomic'));
  assert.ok(candidateMigration.includes('public.is_active_full_admin_actor(p_actor_id)'));
  assert.ok(candidateMigration.includes('INSERT INTO public.admin_audit_logs'));
  assert.ok(candidateMigration.includes('p_dispute_id'));
  assert.ok(candidateMigration.includes('p_winner_id'));
  assert.ok(candidateMigration.includes('REVOKE ALL ON FUNCTION public.admin_resolve_trade_dispute_atomic'));
  assert.ok(candidateMigration.includes('GRANT EXECUTE ON FUNCTION public.admin_resolve_trade_dispute_atomic'));
  assert.ok(fullAdminPredicate.includes('public.verify_admin_login'));
  assert.ok(fullAdminPredicate.includes('is_emergency_frozen'));
});

test('automated dispute event is written outside Realtime and deduplicated by trade/dispute', () => {
  assert.ok(candidateMigration.includes('INSERT INTO public.trade_system_events'));
  assert.ok(candidateMigration.includes('admin-dispute-resolution:'));
  assert.ok(candidateMigration.includes('ON CONFLICT (trade_id, dedupe_key) DO NOTHING'));
  assert.ok(!candidateMigration.includes('INSERT INTO public.trade_messages'));
  assert.ok(candidateMigration.includes('Out-of-Realtime trade system event table'));
});
