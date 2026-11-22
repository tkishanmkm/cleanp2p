import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const root = process.cwd();
const read = (file: string) => readFileSync(join(root, file), 'utf8');
const migration = read('supabase/migrations/20261101170000_persist_admin_2fa_rate_limits.sql');
const limiter = read('src/lib/admin-2fa-rate-limit.ts');
const route = read('src/app/api/admin/auth/2fa-challenge/route.ts');
const session = read('src/lib/admin-2fa-session.ts');
const security = read('src/lib/admin-security.ts');

test('administrator 2FA rate limits persist in Postgres and are restricted to service callers', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.admin_2fa_rate_limits/i);
  assert.match(migration, /PRIMARY KEY/i);
  assert.match(migration, /window_started_at TIMESTAMPTZ/i);
  assert.match(migration, /failures INTEGER/i);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/i);
  assert.match(migration, /admin_2fa_rate_limits_service_access/i);
  for (const fn of ['check_admin_2fa_rate_limit', 'reset_admin_2fa_rate_limit']) {
    assert.match(migration, new RegExp('CREATE OR REPLACE FUNCTION public\\.' + fn + '\\('));
    assert.match(migration, new RegExp('REVOKE ALL ON FUNCTION public\\.' + fn + '\\('));
    assert.match(migration, new RegExp('GRANT EXECUTE ON FUNCTION public\\.' + fn + '\\('));
  }
  assert.match(migration, /auth\.role\(\)[\s\S]*service_role/i);
  assert.match(migration, /INTERVAL '15 minutes'/i);
  assert.match(migration, /ON CONFLICT \(admin_id\) DO UPDATE/i);
});

test('administrator 2FA limiter fails closed and calls the persistent RPCs', () => {
  assert.match(limiter, /import 'server-only'/);
  assert.match(limiter, /createAdminClient/);
  assert.match(limiter, /rpc\('check_admin_2fa_rate_limit'/);
  assert.match(limiter, /rpc\('record_admin_2fa_failure'/);
  assert.match(limiter, /rpc\('reset_admin_2fa_rate_limit'/);
  assert.match(limiter, /throw new Error\('Administrator 2FA protection is temporarily unavailable\.'/);
  assert.doesNotMatch(limiter, /new Map</);
});

test('2FA challenge route checks account status, bounds the body and persists rate-limit changes', () => {
  assert.match(route, /is_banned, is_suspended, is_on_hold, status, account_status/);
  assert.match(route, /This administrator account is disabled/);
  assert.match(route, /MAX_ADMIN_2FA_BODY_BYTES/);
  assert.match(route, /readAdmin2FARequestBody\(req\)/);
  assert.match(route, /await checkAdmin2FARateLimit\(adminId\)/);
  assert.match(route, /await recordAdmin2FAFailure\(adminId\)/);
  assert.match(route, /await resetAdmin2FAFailures\(adminId\)/);
  assert.match(route, /await logAdminSecurityAudit/);
  assert.match(route, /if \(!successAuditSaved\)/);
  assert.match(route, /if \(!recoveryAuditSaved\)/);
  assert.match(route, /rotationResult !== true/);
  assert.match(route, /rotatedRows\.length !== 1/);
});

test('administrator session signing key must decode to exactly 256 bits', () => {
  assert.match(session, /key\.length !== 32/);
  assert.match(session, /ADMIN_2FA_ENCRYPTION_KEY must decode to exactly 32 bytes/);
  assert.match(session, /crypto\.timingSafeEqual/);
});

test('plaintext TOTP secret auto-migration must persist exactly one encrypted profile row', () => {
  assert.match(security, /import 'server-only'/);
  assert.match(security, /isEncryptedAdminTOTPSecret/);
  assert.match(security, /migratedRows\.length !== 1/);
  assert.match(security, /refusing to report a migrated state/);
  assert.match(security, /Promise<boolean>/);
});
