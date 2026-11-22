import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20261101101500_atomic_admin_balance_adjustment.sql', 'utf8');
const helper = readFileSync('src/lib/admin-balance-adjustment.ts', 'utf8');
const route = readFileSync('src/app/api/admin/users/[userId]/balance/route.ts', 'utf8');
const clientHelper = readFileSync('src/lib/admin.ts', 'utf8');
const dialog = readFileSync('src/components/admin/adjust-balance-dialog.tsx', 'utf8');

test('atomic balance RPC is service-role-only, admin-verified, and uses a safe search path', () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.admin_adjust_balance_atomic/);
  assert.match(migration, /SECURITY DEFINER\s+SET search_path = ''/i);
  assert.match(migration, /COALESCE\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(migration, /public\.check_is_admin\(p_admin_id,\s*NULL\)/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_adjust_balance_atomic[\s\S]*FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_adjust_balance_atomic[\s\S]*TO service_role, postgres/);
});

test('ledger records idempotency, and wallet changes plus mandatory audit share one transaction', () => {
  assert.match(migration, /CREATE UNIQUE INDEX IF NOT EXISTS ux_ledger_entries_admin_adjustment_request/);
  assert.match(migration, /pg_advisory_xact_lock\([\s\S]*admin-balance-adjustment:/);
  assert.match(migration, /metadata ->> 'admin_adjustment_request_id'/);
  assert.match(migration, /INSERT INTO public\.ledger_entries/);
  assert.match(migration, /'admin_adjustment'/);
  assert.match(migration, /INSERT INTO public\.admin_audit_logs/);
  assert.match(migration, /'ADMIN_BALANCE_ADJUSTED'/);
  assert.match(migration, /IF FOUND THEN[\s\S]*Idempotency key was already used/);
  assert.doesNotMatch(migration, /UPDATE public\.wallets\b/);
});

test('only spendable balance changes; locked and reserved mirrors are preserved during row creation', () => {
  assert.match(migration, /wallet_assets is the authoritative spendable balance table/i);
  assert.match(migration, /Wallet balance mirrors disagree/);
  assert.match(migration, /Insufficient spendable balance/);
  assert.match(migration, /UPDATE public\.wallet_assets\s+SET balance = v_new_balance,\s+updated_at = NOW\(\)/);
  assert.match(migration, /UPDATE public\.user_wallets\s+SET balance = v_new_balance,\s+updated_at = NOW\(\)/);
  assert.match(migration, /COALESCE\(v_user_locked, 0\), COALESCE\(v_user_reserved, v_user_locked, 0\)/);
  assert.match(migration, /COALESCE\(v_assets_locked, 0\), COALESCE\(v_assets_reserved, v_assets_locked, 0\)/);
  assert.match(migration, /UPPER\(asset_symbol\) = v_asset/);
  assert.doesNotMatch(migration, /SET\s+(?:locked_balance|reserved_balance|in_escrow|in_withdrawal)\s*=/i);
});

test('admin balance API verifies full administrator and helper enforces the default-off feature gate', () => {
  assert.match(route, /verifyServerAdmin\(req\)/);
  assert.match(route, /auth\.supportAdmin === true/);
  assert.match(route, /adjustAdminWalletBalance\(/);
  assert.match(helper, /PAXONES_ATOMIC_ADMIN_BALANCE_ENABLED !== 'true'/);
  assert.match(helper, /ADMIN_BALANCE_ATOMIC_UNVERIFIED/);
  assert.ok(helper.indexOf("PAXONES_ATOMIC_ADMIN_BALANCE_ENABLED !== 'true'") < helper.indexOf('getSupabaseAdminClient()'));
});

test('browser helper no longer calls a mismatched financial RPC or reports success on an ignored error', () => {
  const start = clientHelper.indexOf('export async function adjustUserWalletBalance(');
  const end = clientHelper.indexOf('export async function adminUnblockUser(', start);
  const block = clientHelper.slice(start, end);
  assert.doesNotMatch(block, /supabase\.rpc\(/);
  assert.match(block, /encodeURIComponent\(userId\)/);
  assert.match(block, /result\?\.audit_logged !== true/);
  assert.match(block, /requestId/);
});

test('balance adjustment UI retains one request ID when retrying the identical adjustment', () => {
  assert.match(dialog, /useRef<\{ fingerprint: string; requestId: string \} \| null>/);
  assert.match(dialog, /globalThis\.crypto\.randomUUID\(\)/);
  assert.match(dialog, /adjustmentRequestRef\.current\?\.fingerprint !== fingerprint/);
  assert.match(dialog, /adjustmentRequestRef\.current\.requestId/);
});

console.log('PASS: atomic admin balance adjustment static contract checks.');
console.log('NOTE: PostgreSQL migration replay and transaction-level balance/idempotency tests remain mandatory before enabling the endpoint.');
