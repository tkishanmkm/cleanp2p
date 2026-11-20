import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path: string) => readFileSync(path, 'utf8');

const replayMigration = read('supabase/migrations/20261108162000_harden_trade_escrow_replay_and_ad_lock.sql');
const searchPathMigration = read('supabase/migrations/20261108180000_empty_trade_dependency_search_paths.sql');
const remainingTradeSearchPaths = read('supabase/migrations/20261120194500_step_10_empty_remaining_trade_search_paths.sql');
const legacyAdminRetirement = read('supabase/migrations/20261106030000_retire_legacy_admin_escrow_rpcs_and_harden_expiry_search_path.sql');
const legacyEscrowRetirement = read('supabase/migrations/20261107200000_retire_legacy_trade_escrow_mutation_rpcs.sql');
const adminDisputeSettlement = read('supabase/migrations/20261108043000_restore_atomic_admin_dispute_settlement.sql');
const adminMarkPaid = read('supabase/migrations/20261107230000_restore_admin_mark_paid_authorized_rpc.sql');

const adminDisputeCaller = read('src/lib/admin-dispute-settlement.ts');
const adminTradeRoute = read('src/app/api/admin/trades/[tradeId]/route.ts');
const tradeActionsRoute = read('src/app/api/trades/[tradeId]/actions/route.ts');
const expiryWorker = read('src/jobs/p2pExpiryWorker.ts');

test('canonical trade initiation rejects disabled accounts before idempotent replay', () => {
  assert.match(replayMigration, /TRADE_INITIATION_ACCOUNT_DISABLED/);
  assert.match(replayMigration, /Place the caller eligibility gate before both the idempotency key lookup/);
  assert.match(replayMigration, /COALESCE\(p\.is_banned, FALSE\) = FALSE/);
  assert.match(replayMigration, /COALESCE\(p\.is_restricted, FALSE\) = FALSE/);
  assert.match(replayMigration, /COALESCE\(p\.is_on_hold, FALSE\) = FALSE/);
  assert.match(replayMigration, /COALESCE\(p\.is_suspended, FALSE\) = FALSE/);
  assert.match(replayMigration, /COALESCE\(p\.is_emergency_frozen, FALSE\) = FALSE/);
  assert.match(replayMigration, /p\.status IS NOT NULL/);
  assert.match(replayMigration, /p\.account_status IS NOT NULL/);
});

test('trade initiation caps idempotency keys, deterministically locks the ad and validates replay price', () => {
  assert.match(replayMigration, /pg_catalog\.length\(v_clean_idempotency\) > 200/);
  assert.match(replayMigration, /ORDER BY CASE[\s\S]*WHEN id = TRIM\(p_ad_id\) THEN 0[\s\S]*WHEN public_ad_id = TRIM\(p_ad_id\) THEN 1/);
  assert.match(replayMigration, /LIMIT 1[\s\S]*FOR UPDATE/);
  assert.match(replayMigration, /COALESCE\(v_existing_trade\.price, v_existing_trade\.unit_price\) IS DISTINCT FROM v_unit_price/);
  assert.match(replayMigration, /v_existing_trade\.price IS DISTINCT FROM v_existing_trade\.unit_price/);
  assert.match(replayMigration, /replay price consistency check/);
});

test('trade expiry dependencies and remaining trade trigger/wrapper definers are search-path hardened without changing ACLs', () => {
  for (const signature of [
    'public.get_user_kyc_tier(uuid)',
    'public.get_user_cumulative_buy_volume(uuid)',
    'public.has_pending_withdrawal_approval(uuid)',
    'public.expire_p2p_trade(uuid)',
    'public.cancel_expired_p2p_trades()',
  ]) {
    assert.ok(searchPathMigration.includes(signature), `missing search-path target: ${signature}`);
  }
  assert.match(searchPathMigration, /v_source_after IS DISTINCT FROM v_source_before/);
  assert.match(searchPathMigration, /v_acl_after IS DISTINCT FROM v_acl_before/);
  for (const signature of [
    'public.initiate_p2p_trade(uuid,uuid,uuid,numeric,text,numeric,numeric,text,text)',
    'public.fn_update_user_trade_metrics()',
    'public.handle_trade_status_sync()',
    'public.handle_trade_volume_update()',
    'public.prevent_usd_value_at_trade_update()',
  ]) {
    assert.ok(remainingTradeSearchPaths.includes(signature), `missing remaining trade search-path target: ${signature}`);
  }
  assert.match(remainingTradeSearchPaths, /SET search_path TO %L/);
  assert.match(remainingTradeSearchPaths, /v_source_after IS DISTINCT FROM v_source_before/);
  assert.match(remainingTradeSearchPaths, /v_acl_after IS DISTINCT FROM v_acl_before/);
});

test('obsolete status-only admin escrow RPCs are retired while canonical release/cancel/dispute RPCs remain', () => {
  for (const signature of [
    'public.admin_refund_escrow(character varying,uuid,text)',
    'public.admin_release_escrow(character varying,uuid,text)',
    'public.admin_resolve_dispute(uuid,uuid,text,text)',
  ]) {
    assert.ok(legacyAdminRetirement.includes(signature), `missing legacy admin RPC: ${signature}`);
  }
  assert.match(legacyAdminRetirement, /REVOKE ALL ON FUNCTION public\.admin_release_escrow/);
  assert.match(legacyAdminRetirement, /REVOKE ALL ON FUNCTION public\.admin_resolve_dispute/);
  assert.match(legacyAdminRetirement, /ALTER FUNCTION public\.cancel_expired_p2p_trades\(\) SET search_path = ''/);
  assert.match(legacyAdminRetirement, /ALTER FUNCTION public\.expire_p2p_trade\(uuid\) SET search_path = ''/);
  assert.match(legacyAdminRetirement, /public\.release_trade_escrow\(uuid,uuid\)/);
  assert.match(legacyAdminRetirement, /public\.cancel_p2p_trade\(uuid,uuid,text\)/);
});

test('legacy financial escrow RPC retirement waits for atomic dispute wrapper dependency', () => {
  assert.match(legacyEscrowRetirement, /admin_resolve_trade_dispute_atomic\(uuid,uuid,uuid,uuid,text,text\)/);
  assert.match(legacyEscrowRetirement, /Atomic admin dispute settlement migration must be installed/);
  assert.match(legacyEscrowRetirement, /public\.cancel_trade_and_release_escrow\(uuid,text\)/);
  assert.match(legacyEscrowRetirement, /public\.refund_trade_escrow_to_seller\(uuid,uuid,text\)/);
  assert.match(legacyEscrowRetirement, /public\.complete_trade\(uuid\)/);
  assert.match(legacyEscrowRetirement, /TO postgres/);
});

test('current admin dispute and mark-paid routes depend on server-only actor-bound wrappers', () => {
  assert.match(adminDisputeCaller, /DISPUTE_ATOMIC_SETTLEMENT_UNVERIFIED/);
  assert.match(adminDisputeCaller, /rpc\('admin_resolve_trade_dispute_atomic'/);
  assert.match(adminDisputeSettlement, /PAXONES_ATOMIC_DISPUTE_SETTLEMENT_ENABLED/);
  assert.match(adminDisputeSettlement, /COALESCE\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(adminDisputeSettlement, /public\.is_active_full_admin_actor\(p_actor_id\)/);
  assert.match(adminDisputeSettlement, /mandatory audit insert is in the same transaction/i);
  assert.match(adminMarkPaid, /CREATE OR REPLACE FUNCTION public\.admin_mark_trade_paid_authorized/);
  assert.match(adminMarkPaid, /public\.is_active_admin_identity\(p_actor_id\)/);
  assert.match(adminMarkPaid, /mandatory audit insert is in the same transaction/i);
  assert.match(adminTradeRoute, /rpc\("admin_mark_trade_paid_authorized"/);
});

test('participant release/cancel and expiry stay on canonical database RPCs', () => {
  assert.match(tradeActionsRoute, /rpc\('mark_p2p_trade_paid'/);
  assert.match(tradeActionsRoute, /rpc\('release_trade_escrow'/);
  assert.match(tradeActionsRoute, /rpc\('cancel_p2p_trade'/);
  assert.match(expiryWorker, /rpc\('cancel_expired_p2p_trades'/);
  assert.doesNotMatch(expiryWorker, /\.from\(['"]trades['"]\)\s*\.update\(/);
});
