import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

const root = process.cwd();
const route = readFileSync(join(root, 'src/app/api/admin/disputes/resolve/route.ts'), 'utf8');
const action = readFileSync(join(root, 'src/app/adminnarayan/disputes/actions.ts'), 'utf8');
const helper = readFileSync(join(root, 'src/lib/admin-dispute-settlement.ts'), 'utf8');
const migration = readFileSync(join(root, 'supabase/migrations/20261003000000_p2p_dispute_schema_and_resolution_alignment.sql'), 'utf8');

test('all administrator dispute entry points authenticate and delegate to the default-off atomic helper', () => {
  assert.match(route, /verifyServerAdmin\(req\)/);
  assert.match(route, /auth\.supportAdmin === true/);
  assert.match(route, /resolveDisputeAtomically\(/);
  assert.equal(/\.rpc\s*\(/.test(route), false);
  assert.match(action, /verifyServerAdmin\(\)/);
  assert.match(action, /resolveDisputeAtomically\(/);
  assert.equal(/\.rpc\s*\(/.test(action), false);
  assert.match(helper, /PAXONES_ATOMIC_DISPUTE_SETTLEMENT_ENABLED !== 'true'/);
  assert.match(helper, /DISPUTE_ATOMIC_SETTLEMENT_UNVERIFIED/);
});

test('historical resolved-dispute retry branch does not compare the requested outcome', () => {
  const start = migration.indexOf("IF LOWER(COALESCE(v_dispute.status::TEXT, '')) = 'resolved' THEN");
  const end = migration.indexOf('END IF;', start);
  assert.ok(start >= 0 && end > start);
  const branch = migration.slice(start, end);
  assert.ok(branch.includes("'winner_id', v_dispute.winner_id"));
  assert.equal(branch.includes('p_winner_id <> v_dispute.winner_id'), false);
  assert.equal(branch.includes('p_resolution <> v_dispute.resolution'), false);
});

test('canonical resolver persists the chosen winner and resolution metadata', () => {
  const start = migration.indexOf('CREATE OR REPLACE FUNCTION public.resolve_trade_dispute(');
  const end = migration.indexOf('$$;', start);
  assert.ok(start >= 0 && end > start);
  const fn = migration.slice(start, end);
  assert.match(fn, /winner_id\s*=\s*p_winner_id/);
  assert.match(fn, /resolved_by\s*=\s*v_effective_caller/);
  assert.match(fn, /status\s*=\s*'resolved'/);
});

console.log('PASS: administrator dispute settlement is default-off and server-mediated.');
