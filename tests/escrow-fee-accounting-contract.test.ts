import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const releaseMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261123164014_record_platform_escrow_fees_on_release_and_fix_admin_stats.sql'),
  'utf8',
);
const statsMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261123164252_repair_admin_financial_stats_sweeper_and_escrow_fee_sources.sql'),
  'utf8',
);
const dependencyMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261123162654_empty_trade_dependency_search_paths.sql'),
  'utf8',
);
const fullAdminMigration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261123163451_restore_active_full_admin_actor_predicate_for_atomic_dispute.sql'),
  'utf8',
);

test('escrow fee is posted on successful release and exact terminal replay', () => {
  assert.match(releaseMigration, /ALTER FUNCTION public\.record_platform_ledger_entry[\s\S]*?SET search_path = ''/);
  assert.ok(releaseMigration.includes("p_entry_type := 'trade_fee_collected'"));
  assert.ok(releaseMigration.includes("p_idempotency_key := 'pf_p2pfee_' || p_trade_id::TEXT"));
  assert.ok(releaseMigration.includes('p_amount := v_trade.escrow_fee'));
  assert.ok(releaseMigration.includes("p_direction := 'CREDIT'"));
  assert.ok(releaseMigration.includes('v_replay_marker'));
  assert.ok(releaseMigration.includes('Already released (idempotent success)'));
  assert.ok(releaseMigration.includes('v_active_marker'));
  assert.ok(releaseMigration.includes('-- 7e. Update Trade State to Completed'));
  assert.match(releaseMigration, /Cancel and expiry[\s\S]*?refund the complete escrow amount/);
  assert.ok(releaseMigration.includes("v_updated := replace(v_definition, v_replay_marker, v_replay_marker || v_fee_block)"));
  assert.ok(releaseMigration.includes("v_updated := replace(v_updated, v_active_marker, v_fee_block || v_active_marker)"));
});

test('admin report sums escrow fees from the actual RELEASED escrow state', () => {
  const statsFunction = releaseMigration.split('CREATE OR REPLACE FUNCTION public.get_admin_financial_stats()')[1] || '';
  assert.ok(statsFunction.includes("UPPER(COALESCE(escrow_status::TEXT,'')) = 'RELEASED'"));
  assert.ok(statsFunction.includes('total_escrow_fees'));
  assert.ok(!statsFunction.includes("WHERE status = 'released'"));
});

test('sweeper gas statistic uses recorded USD-equivalent ledger expenses', () => {
  const functionBody = statsMigration.split('CREATE OR REPLACE FUNCTION public.get_admin_financial_stats()')[1] || '';
  assert.ok(functionBody.includes('SUM(usd_equivalent)'));
  assert.ok(functionBody.includes("entry_type = 'network_gas_expense'"));
  assert.ok(functionBody.includes("direction = 'DEBIT'"));
  assert.ok(functionBody.includes("ref_table IN ('sweep_operations', 'gas_funding_operations')"));
  assert.ok(!functionBody.includes('sweeper_fee_paid'));
});

test('release, cancel and expiry remain separate settlement paths', () => {
  assert.ok(releaseMigration.includes("public.release_trade_escrow(uuid,uuid)"));
  assert.ok(releaseMigration.includes('record_platform_ledger_entry'));
  assert.ok(!releaseMigration.includes('ALTER FUNCTION public.cancel_p2p_trade'));
  assert.ok(!releaseMigration.includes('ALTER FUNCTION public.expire_p2p_trade'));
});

test('trade dependency hardening verifies original ACLs and changes only search_path', () => {
  for (const name of [
    'public.get_user_kyc_tier(uuid)',
    'public.get_user_cumulative_buy_volume(uuid)',
    'public.has_pending_withdrawal_approval(uuid)',
    'public.expire_p2p_trade(uuid)',
    'public.cancel_expired_p2p_trades()',
  ]) assert.ok(dependencyMigration.includes(name), name);
  assert.ok(dependencyMigration.includes('ALTER FUNCTION %s SET search_path TO %L'));
  assert.ok(dependencyMigration.includes("      ''"));
  assert.ok(dependencyMigration.includes('v_acl_after IS DISTINCT FROM v_acl_before'));
  assert.ok(dependencyMigration.includes("has_function_privilege('service_role', v_oid, 'EXECUTE')"));
  assert.ok(dependencyMigration.includes('v_source_after IS DISTINCT FROM v_source_before'));
});

test('full-admin actor predicate uses durable verification and is internal-only', () => {
  assert.ok(fullAdminMigration.includes('public.verify_admin_login'));
  assert.ok(fullAdminMigration.includes('p.status::text'));
  assert.ok(fullAdminMigration.includes('is_emergency_frozen'));
  assert.ok(fullAdminMigration.includes('is_minor_restricted'));
  assert.ok(fullAdminMigration.includes('REVOKE ALL ON FUNCTION public.is_active_full_admin_actor'));
  assert.ok(fullAdminMigration.includes('GRANT EXECUTE ON FUNCTION public.is_active_full_admin_actor(uuid) TO postgres'));
});
