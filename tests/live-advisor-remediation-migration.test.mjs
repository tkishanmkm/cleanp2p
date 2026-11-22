import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20261031120000_remediate_live_database_advisors.sql',
  'utf8'
);

for (const policy of [
  'admin_user_status_snapshots_select_policy',
  'Users can view their own deposit addresses',
  'Users can view disputes related to their trades',
  'Enable read for own feedback',
  'Users can view their own KYC record',
  'user_balances_all_admin',
  'trade_moderator_participations_mutate',
  'trade_moderator_participations_select',
  'Users can view own block relationships',
  'Users can view their own withdrawals',
  'Admins can view platform ledger'
]) assert.ok(sql.includes(policy), 'Missing cleanup for policy: ' + policy);

assert.match(sql, /\(SELECT public\.is_admin\(\)\)/i);
assert.doesNotMatch(sql, /raw_user_meta_data/);
assert.match(sql, /ALTER POLICY "Admins can view audit logs"[\s\S]*?\(SELECT public\.is_admin\(\)\)/i);
assert.match(sql, /ALTER POLICY "Allow participants and admins to view disputes"[\s\S]*?OR \(SELECT public\.is_admin\(\)\)/i);
assert.match(sql, /CREATE POLICY "trade_moderator_participations_insert"[\s\S]*?WITH CHECK \(\(SELECT public\.is_admin\(\)\)\)/i);
assert.match(sql, /ALTER POLICY "user_blocks_insert_policy"[\s\S]*?public\.is_admin\(\)/i);
assert.match(sql, /ALTER POLICY "user_blocks_delete_policy"[\s\S]*?public\.is_admin\(\)/i);
assert.match(sql, /ALTER FUNCTION public\.get_emergency_mode\(\) SECURITY INVOKER/i);
assert.match(sql, /pg_get_expr\(p\.polqual[\s\S]*?position\('auth\.uid\(\)' IN COALESCE/i);
assert.match(sql, /position\('auth\.role\(\)' IN COALESCE/i);
assert.match(sql, /ALTER POLICY/i);
assert.match(sql, /SELECT auth\.uid\(\) AS uid/);
assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_deposits_user_id/i);
assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_platform_ledger_entries_related_user_id/i);
assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_profiles_emergency_frozen_by/i);
assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_sweep_queue_user_id/i);
assert.match(sql, /CREATE INDEX IF NOT EXISTS idx_utxo_reservations_sweep_id/i);
assert.match(sql, /DROP CONSTRAINT IF EXISTS uq_admin_main_wallets_currency/i);
assert.match(sql, /DROP CONSTRAINT IF EXISTS uq_profiles_wallet_index/i);
assert.match(sql, /DROP CONSTRAINT IF EXISTS unique_wallet_address/i);
assert.match(sql, /DROP INDEX IF EXISTS public\.idx_feedback_trade/i);
assert.match(sql, /DROP INDEX IF EXISTS public\.transfers_sender_id_idempotency_key_unique/i);
assert.match(sql, /BEGIN;[\s\S]*COMMIT;/i);

console.log('PASS: live advisor remediation migration contract checks');
console.log('NOTE: runtime migration replay is still required before any production application.');
