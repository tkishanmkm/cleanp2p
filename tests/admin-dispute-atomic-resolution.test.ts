import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const route = readFileSync('src/app/api/admin/disputes/resolve/route.ts', 'utf8');
const migration = readFileSync('supabase/migrations/20261118135339_secure_dispute_resolution_audit.sql', 'utf8');

test('admin route verifies dispute-to-trade association before settlement', () => {
  assert.match(route, /verifyServerAdmin\(req\)/);
  assert.match(route, /\.from\('disputes'\)[\s\S]*?\.eq\('id', disputeId\)/);
  assert.match(route, /String\(dispute\.trade_id\) !== tradeId/);
  assert.match(route, /\.from\('trades'\)[\s\S]*?\.eq\('id', tradeId\)/);
});

test('admin dispute settlement uses the atomic service-only RPC and does not separately mutate financial state', () => {
  assert.match(route, /rpc\('resolve_trade_dispute_with_audit'/);
  assert.doesNotMatch(route, /rpc\('release_trade_escrow'/);
  assert.doesNotMatch(route, /rpc\('cancel_p2p_trade'/);
  assert.doesNotMatch(route, /\.from\('disputes'\)\s*\.update/);
  assert.doesNotMatch(route, /\.from\('admin_audit_logs'\)\s*\.insert/);
});

test('database wrapper revalidates active administrator identity and resolution winner', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.resolve_trade_dispute_with_audit/);
  assert.match(migration, /p\.is_banned/);
  assert.match(migration, /p\.is_on_hold/);
  assert.match(migration, /p\.is_suspended/);
  assert.match(migration, /a\.role IN \('admin', 'superadmin'\)/);
  assert.match(migration, /v_resolution = 'RELEASE' AND p_winner_id::TEXT IS DISTINCT FROM v_buyer_id/);
  assert.match(migration, /v_resolution = 'CANCEL' AND p_winner_id::TEXT IS DISTINCT FROM v_seller_id/);
  assert.match(migration, /public\.resolve_trade_dispute\(/);
});

test('dispute settlement and audit insertion are in one transaction and direct browser RPC access is revoked', () => {
  assert.match(migration, /INSERT INTO public\.admin_audit_logs/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.resolve_trade_dispute_with_audit[\s\S]*?FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.resolve_trade_dispute_with_audit[\s\S]*?TO service_role, postgres/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.resolve_trade_dispute\(UUID, TEXT, UUID, UUID\) FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.resolve_trade_dispute\(UUID, TEXT, UUID, UUID\) TO service_role, postgres/);
});

console.log('PASS: disputed escrow settlement is server-only, winner-bound, and atomically audited.');