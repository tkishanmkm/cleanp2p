import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = 'supabase/migrations/';
const cancelSql = readFileSync(root + '20261118135344_harden_cancel_trade_admin_identity.sql', 'utf8');
const paidSql = readFileSync(root + '20261118135402_harden_mark_paid_admin_boundary.sql', 'utf8');
const interventionSql = readFileSync(root + '20261118135356_admin_trade_intervention_atomic.sql', 'utf8');
const disputeSql = readFileSync(root + '20261118135339_secure_dispute_resolution_audit.sql', 'utf8');
const actionRoute = readFileSync('src/app/api/trades/[tradeId]/actions/route.ts', 'utf8');
const sellerRelease = readFileSync('src/app/api/p2p/trade/release/route.ts', 'utf8');
const legacyRelease = readFileSync('src/app/api/p2p/trades/[tradeId]/release/route.ts', 'utf8');
const adminTradeRoute = readFileSync('src/app/api/admin/trades/[tradeId]/route.ts', 'utf8');
const adminDisputeRoute = readFileSync('src/app/api/admin/disputes/resolve/route.ts', 'utf8');

test('authenticated cancellation cannot obtain admin override from user-editable metadata or stale JWT roles', () => {
  assert.doesNotMatch(cancelSql, /raw_user_meta_data|raw_app_meta_data/);
  assert.match(cancelSql, /public\.profiles AS p/);
  assert.match(cancelSql, /public\.app_admins AS a/);
  assert.match(cancelSql, /p\.is_restricted/);
  assert.match(cancelSql, /IF v_is_admin AND auth\.role\(\) IS DISTINCT FROM 'service_role' THEN\s+v_is_admin := FALSE/);
  assert.match(cancelSql, /GRANT EXECUTE ON FUNCTION public\.cancel_p2p_trade\(UUID, UUID, TEXT\) TO authenticated/);
});

test('browser mark-paid RPC is buyer-only; admin override requires an active server-role identity', () => {
  assert.doesNotMatch(paidSql, /raw_user_meta_data|raw_app_meta_data/);
  assert.match(paidSql, /IF auth\.role\(\) = 'service_role' THEN/);
  assert.match(paidSql, /public\.profiles AS p/);
  assert.match(paidSql, /public\.app_admins AS a/);
  assert.match(paidSql, /IF NOT \(v_is_buyer OR v_is_admin\)/);
});

test('all admin escrow interventions are service-only and revalidate active full-admin identity', () => {
  assert.match(interventionSql, /auth\.role\(\) IS DISTINCT FROM 'service_role'/);
  assert.match(interventionSql, /ACTIVE_ADMIN_REQUIRED/);
  assert.match(interventionSql, /v_admin_profile ->> 'is_restricted'/);
  assert.match(interventionSql, /a\.role IN \('admin', 'superadmin'\)/);
  assert.match(interventionSql, /public\.resolve_trade_dispute_with_audit/);
  assert.match(interventionSql, /public\.release_trade_escrow/);
  assert.match(interventionSql, /public\.cancel_p2p_trade/);
  assert.match(interventionSql, /public\.mark_p2p_trade_paid/);
  assert.match(interventionSql, /INSERT INTO public\.admin_audit_logs/);
  assert.match(interventionSql, /GRANT EXECUTE ON FUNCTION public\.admin_intervene_trade_escrow[\s\S]*?TO service_role, postgres/);
  assert.doesNotMatch(interventionSql, /TO authenticated/);
});

test('dispute resolver is service-only and atomic with audit insertion', () => {
  assert.match(disputeSql, /INSERT INTO public\.admin_audit_logs/);
  assert.match(disputeSql, /REVOKE ALL ON FUNCTION public\.resolve_trade_dispute\(UUID, TEXT, UUID, UUID\) FROM PUBLIC, anon, authenticated/);
  assert.match(disputeSql, /GRANT EXECUTE ON FUNCTION public\.resolve_trade_dispute\(UUID, TEXT, UUID, UUID\) TO service_role, postgres/);
});

test('user trade action route uses authenticated RPCs and no longer trusts metadata for expiry', () => {
  assert.match(actionRoute, /userRpcClient\.rpc\('mark_p2p_trade_paid'/);
  assert.match(actionRoute, /userRpcClient\.rpc\('cancel_p2p_trade'/);
  assert.match(actionRoute, /verifyServerAdmin\(req\)/);
  assert.doesNotMatch(actionRoute, /user\.app_metadata\?\.role|user\.user_metadata\?\.role/);
});

test('both seller release endpoints fail closed on trade ownership, dispute lookup and 2FA profile lookup', () => {
  assert.match(sellerRelease, /const isSeller = String\(trade\.seller_id\) === user\.id/);
  assert.match(legacyRelease, /String\(trade\.seller_id\) !== user\.id/);
  for (const route of [sellerRelease, legacyRelease]) {
    assert.match(route, /disputeError|disputeLookupError/);
    assert.match(route, /profileError/);
    assert.match(route, /!sellerProfile/);
    assert.match(route, /verify2FAOTP/);
    assert.match(route, /TRADE_DISPUTE_REQUIRES_ADMIN_RESOLUTION|Disputed trades must be resolved/);
  }
});

test('admin trade and dispute routes use the atomic server-side intervention RPCs', () => {
  assert.match(adminTradeRoute, /verifyServerAdmin\(req\)/);
  assert.match(adminTradeRoute, /rpc\("admin_intervene_trade_escrow"/);
  assert.match(adminDisputeRoute, /verifyServerAdmin\(req\)/);
  assert.match(adminDisputeRoute, /rpc\('resolve_trade_dispute_with_audit'/);
  assert.doesNotMatch(adminTradeRoute, /rpc\("release_trade_escrow"|rpc\("cancel_p2p_trade"/);
});

console.log('PASS: user cancellation, paid confirmation, seller release and admin escrow/dispute settlement have separate trusted authorization boundaries.');