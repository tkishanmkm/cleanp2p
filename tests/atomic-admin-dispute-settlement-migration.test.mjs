import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20261101090000_atomic_admin_dispute_settlement.sql',
  'utf8',
);
const helper = readFileSync('src/lib/admin-dispute-settlement.ts', 'utf8');
const route = readFileSync('src/app/api/admin/disputes/resolve/route.ts', 'utf8');

const functionStart = migration.indexOf('CREATE OR REPLACE FUNCTION public.admin_resolve_trade_dispute_atomic');
const functionEnd = migration.indexOf('$function$;', functionStart);
const body = migration.slice(functionStart, functionEnd);
const executableBody = body.replace(/--[^\r\n]*/g, '');

test('atomic settlement wrapper is service-role-only and uses an empty search path', () => {
  assert.notEqual(functionStart, -1);
  assert.match(body, /SECURITY DEFINER\s+SET search_path = ''/i);
  assert.match(body, /COALESCE\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_resolve_trade_dispute_atomic[\s\S]*TO service_role, postgres/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_resolve_trade_dispute_atomic[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
});

test('only a durable active-admin grant may initiate settlement using the deployed two-argument signature', () => {
  assert.match(body, /public\.check_is_admin\(p_actor_id,\s*NULL\)/);
  assert.match(body, /banned, suspended, and on-hold/);
  assert.doesNotMatch(executableBody, /raw_user_meta_data/);
  assert.match(migration, /public\.check_is_admin\(v_effective_caller, NULL\)/);
  assert.match(migration, /Administrator email does not match the canonical Auth email/);
});

test('trade and dispute are locked, uniquely matched, and winner must be a participant', () => {
  const disputeLock = body.indexOf('FROM public.disputes AS d');
  const tradeLock = body.indexOf('FROM public.trades AS t');
  assert.ok(disputeLock >= 0 && tradeLock > disputeLock, 'lock order must match canonical dispute-then-trade resolver');
  assert.match(body, /v_dispute_trade_id <> p_trade_id/);
  assert.match(body, /v_open_dispute_count <> 1/);
  assert.match(body, /p_winner_id::TEXT = v_trade\.buyer_id::TEXT/);
  assert.match(body, /p_winner_id::TEXT = v_trade\.seller_id::TEXT/);
  assert.match(body, /Only an open dispute can be resolved/);
});

test('escrow settlement, persisted-state verification, and mandatory admin audit are one transaction', () => {
  assert.match(body, /public\.resolve_trade_dispute\(/);
  assert.match(body, /v_result ->> 'success'/);
  assert.match(body, /v_final_dispute\.winner_id IS DISTINCT FROM p_winner_id/);
  assert.match(body, /v_final_dispute\.resolved_by IS DISTINCT FROM p_actor_id/);
  assert.match(body, /Escrow settlement did not reach the expected terminal trade state/);
  const audit = body.indexOf('INSERT INTO public.admin_audit_logs');
  const message = body.indexOf('INSERT INTO public.trade_messages');
  const notifications = body.indexOf('INSERT INTO public.notifications');
  assert.ok(audit > body.indexOf('public.resolve_trade_dispute('));
  assert.ok(message > audit && notifications > audit);
  assert.doesNotMatch(body, /UPDATE\s+public\.wallet_assets|INSERT\s+INTO\s+public\.ledger_entries/i);
  assert.match(body, /Dispute is already resolved or requires manual financial reconciliation/);
  assert.match(body, /v_audit_exists/);
});

test('legacy resolver is admin-hardened, pinned to an empty search path, and no longer directly executable', () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.resolve_trade_dispute[\s\S]*FROM PUBLIC, anon, authenticated, service_role, supabase_auth_admin/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.resolve_trade_dispute[\s\S]*TO postgres/);
  assert.match(migration, /ALTER FUNCTION public\.resolve_trade_dispute[\s\S]*SET search_path = ''/);
  assert.match(migration, /v_is_admin := public\.check_is_admin\(v_effective_caller, NULL\)/);
});

test('application server boundary is gated and verifies both settlement and audit response', () => {
  assert.match(helper, /PAXONES_ATOMIC_DISPUTE_SETTLEMENT_ENABLED !== 'true'/);
  assert.match(helper, /import ['"]server-only['"]/);
  assert.match(helper, /admin_resolve_trade_dispute_atomic/);
  assert.match(helper, /data\.settlement_succeeded !== true/);
  assert.match(helper, /data\.audit_logged !== true/);
  assert.match(route, /verifyServerAdmin\(req\)/);
  assert.match(route, /auth\.supportAdmin === true/);
  assert.match(route, /resolveDisputeAtomically\(/);
});

console.log('PASS: atomic dispute settlement static contract checks.');
console.log('NOTE: static checks do not parse PL/pgSQL or substitute for isolated wallet/ledger/concurrency integration tests.');
