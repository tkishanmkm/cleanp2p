import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const migrationPath = join(
  process.cwd(),
  'supabase',
  'migrations',
  '20261024193706_guard_didit_kyc_active_session.sql',
);
const sql = readFileSync(migrationPath, 'utf8').toLowerCase();

test('KYC sync RPC locks the profile before applying a decision', () => {
  assert.match(sql, /where p\.id = p_user_id\s+for update/);
});

test('KYC sync RPC rejects a stale session before any status mutation', () => {
  const guardIndex = sql.indexOf("'stale_session'");
  const approvalIndex = sql.indexOf("kyc_status = 'approved'");
  assert.notEqual(guardIndex, -1);
  assert.notEqual(approvalIndex, -1);
  assert.ok(guardIndex < approvalIndex, 'stale-session guard must precede approval writes');
  assert.match(sql, /v_didit_session_id is distinct from p_session_id/);
  assert.match(sql, /v_vendor_session_id is distinct from p_session_id/);
});

test('KYC verification record must belong to the same user and session', () => {
  assert.match(sql, /where kv\.session_id = p_session_id/);
  assert.match(sql, /v_verification_user_id is distinct from p_user_id/);
  assert.match(sql, /where session_id = p_session_id and user_id = p_user_id/);
});

test('KYC sync RPC rejects unknown statuses instead of treating them as declines', () => {
  assert.match(sql, /'unsupported_status'/);
  assert.match(sql, /elsif v_status in \('declined', 'rejected', 'failed'\)/);
});
