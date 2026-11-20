import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

const migration = read(
  'supabase/migrations/20261120193000_step_09_harden_legacy_p2p_and_admin_snapshot_rls.sql'
);
const p2pTradesRoute = read('src/app/api/p2p/trades/route.ts');
const legacyOrdersRoute = read('src/app/api/p2p/orders/route.ts');
const legacyOrderIdRoute = read('src/app/api/p2p/orders/[id]/route.ts');
const tradeActionsRoute = read('src/app/api/trades/[tradeId]/actions/route.ts');
const legacyEscrowService = read('src/lib/p2p/escrowService.ts');

test('legacy P2P mirror tables retain participant/owner SELECT but lose direct browser mutations', () => {
  assert.match(migration, /DROP POLICY "Users can update their own trades" ON public\.p2p_trades/);
  assert.match(migration, /REVOKE ALL ON TABLE public\.p2p_trades[\\s\\S]*FROM PUBLIC, anon, authenticated/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.p2p_trades TO authenticated/);
  assert.match(migration, /GRANT ALL ON TABLE public\.p2p_trades TO service_role/);
  assert.match(migration, /has_table_privilege\('anon','public\.p2p_trades','SELECT'\)/);
  assert.match(migration, /DROP POLICY "Users can manage their own p2p orders" ON public\.p2p_orders/);
  assert.match(migration, /CREATE POLICY "Users can view their own legacy p2p orders"[\s\S]*FOR SELECT[\s\S]*user_id = \(SELECT auth\.uid\(\)\)/);
  assert.match(migration, /GRANT SELECT ON TABLE public\.p2p_orders TO authenticated/);
  assert.match(migration, /GRANT ALL ON TABLE public\.p2p_orders TO service_role/);
  assert.match(migration, /has_table_privilege\('anon','public\.p2p_orders','SELECT'\)/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.is_active_admin_for_status_snapshot_access\(\)[\s\S]*TO authenticated, postgres/);
});

test('legacy P2P server compatibility reads remain available without browser write dependence', () => {
  assert.match(p2pTradesRoute, /await supabase\.auth\.getUser\(\)/);
  assert.match(p2pTradesRoute, /\.from\('p2p_trades'\)[\s\S]*\.select\('\*'\)/);
  assert.doesNotMatch(p2pTradesRoute, /\.from\(['"]p2p_trades['"]\)[\s\S]*\.(?:insert|update|delete)\(/);

  assert.match(legacyOrdersRoute, /LEGACY_P2P_ORDERS_ENDPOINT_RETIRED/);
  assert.match(legacyOrderIdRoute, /getSupabaseAdminClient\(\)/);
  assert.match(legacyOrderIdRoute, /await authClient\.auth\.getUser\(\)/);
  assert.match(legacyOrderIdRoute, /order\.buyer_id !== userId/);
  assert.match(legacyOrderIdRoute, /\.eq\('status', order\.status\)/);
  assert.match(legacyOrderIdRoute, /status === 'COMPLETED'/);

  assert.match(tradeActionsRoute, /const adminClient = getSupabaseAdminClient\(\)/);
  assert.match(tradeActionsRoute, /adminClient\.rpc\('mark_p2p_trade_paid'/);
  assert.match(tradeActionsRoute, /\.from\('p2p_trades'\)[\s\S]*\.update\(\{ status: 'PAID'/);
  assert.match(legacyEscrowService, /getSupabaseAdminClient\(\)/);
  assert.match(legacyEscrowService, /Legacy direct hot-wallet escrow release is disabled/);
  assert.doesNotMatch(legacyEscrowService, /executeHotWalletWithdrawal/);
});

test('admin snapshot RLS delegates to the active-admin identity check, not profile flags alone', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.is_active_admin_for_status_snapshot_access\(\)/);
  assert.match(migration, /SECURITY DEFINER[\s\S]*SET search_path TO ''/);
  assert.match(migration, /SELECT public\.is_active_admin_identity\(auth\.uid\(\)\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.is_active_admin_for_status_snapshot_access\(\)[\s\S]*FROM PUBLIC, anon, service_role, supabase_auth_admin/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.is_active_admin_for_status_snapshot_access\(\)[\s\S]*TO authenticated, postgres/);
  assert.match(migration, /DROP POLICY admin_user_status_snapshots_mutate_policy/);
  assert.match(migration, /CREATE POLICY admin_user_status_snapshots_active_admin_read[\s\S]*FOR SELECT[\s\S]*is_active_admin_for_status_snapshot_access/);
  assert.match(migration, /CREATE POLICY admin_user_status_snapshots_service_role_all[\s\S]*FOR ALL[\s\S]*TO service_role/);
});

test('migration aborts on unreviewed policy/ACL drift and preserves the service-role path', () => {
  assert.match(migration, /p2p_trades mutation policy set differs/);
  assert.match(migration, /snapshot helper function name already exists/);
  assert.match(migration, /p2p_orders policy set differs/);
  assert.match(migration, /admin_user_status_snapshots policy set differs/);
  assert.match(migration, /Required service_role table privileges have drifted/);
  assert.match(migration, /Step 09 postcondition failed/);
  assert.match(migration, /has_table_privilege\('service_role','public\.p2p_trades','UPDATE'\)/);
  assert.match(migration, /has_table_privilege\('service_role','public\.p2p_orders','UPDATE'\)/);
  assert.match(migration, /has_table_privilege\('service_role','public\.admin_user_status_snapshots','INSERT'\)/);
});
