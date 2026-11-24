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
const crypto = read('src/lib/admin-2fa-crypto.ts');

test('administrator 2FA rate limits persist in Postgres and are restricted to service callers', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.admin_2fa_rate_limits/i);
  assert.match(migration, /admin_id UUID PRIMARY KEY REFERENCES public\.profiles\(id\)/i);
  assert.match(migration, /window_started_at TIMESTAMPTZ/i);
  assert.match(migration, /failures INTEGER NOT NULL DEFAULT 0/i);
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
  assert.match(migration, /failures = CASE[\s\S]*current_limit\.failures \+ 1/i);
  assert.match(migration, /'allowed', v_failures <= 5/i);
  assert.match(migration, /FROM PUBLIC, anon, authenticated/i);
});

test('administrator 2FA limiter atomically reserves attempts through one persistent check RPC', () => {
  assert.match(limiter, /import 'server-only'/);
  assert.match(limiter, /createAdminClient/);
  assert.match(limiter, /rpc\('check_admin_2fa_rate_limit'/);
  assert.match(limiter, /rpc\('reset_admin_2fa_rate_limit'/);
  assert.doesNotMatch(limiter, /record_admin_2fa_failure|recordAdmin2FAFailure|new Map</);
  assert.match(limiter, /Number\(value\.remaining_attempts\) > 5/);
  assert.match(limiter, /Number\(value\.retry_after_seconds\) > 900/);
  assert.match(limiter, /throw new Error\('Administrator 2FA protection is temporarily unavailable\.'/);
});

test('2FA challenge validates current admin state and persists limit/audit before issuing its signed cookie', () => {
  assert.match(route, /is_banned, is_suspended, is_restricted, is_on_hold, is_emergency_frozen, is_minor_restricted, status, account_status/);
  assert.match(route, /This administrator account is disabled/);
  assert.match(route, /verify_admin_login/);
  assert.match(route, /MAX_ADMIN_2FA_BODY_BYTES/);
  assert.match(route, /readAdmin2FARequestBody\(req\)/);
  assert.match(route, /await checkAdmin2FARateLimit\(adminId\)/);
  assert.match(route, /await ensureAdminTOTPSecretEncrypted\(adminDb, adminId, profile\)/);
  assert.match(route, /await resetAdmin2FAFailures\(adminId\)/);
  assert.match(route, /await logAdminSecurityAudit/);
  assert.match(route, /if \(!successAuditSaved\)/);
  assert.match(route, /rotationResult !== true/);
  assert.match(route, /setAdmin2FACookie\(response, sessionToken\)/);
});

test('administrator session signing key is 256-bit and token uses a bound, time-limited HMAC', () => {
  assert.match(session, /key\.length !== 32/);
  assert.match(session, /ADMIN_2FA_ENCRYPTION_KEY must decode to exactly 32 bytes/);
  assert.match(session, /crypto\.hkdfSync\(/);
  assert.match(session, /createHmac\('sha256'/);
  assert.match(session, /crypto\.timingSafeEqual/);
  assert.match(session, /ADMIN_2FA_SESSION_MAX_AGE_SECONDS = 12 \* 60 \* 60/);
  assert.match(session, /decodedVersionTag !== cleanCurrentVersion/);
  assert.match(session, /httpOnly: true/);
  assert.match(session, /sameSite: 'lax'/);
});

test('legacy TOTP migration uses authenticated encryption and compare-and-set verification', () => {
  assert.match(crypto, /export function isEncryptedAdminTOTPSecret/);
  assert.match(crypto, /createCipheriv\('aes-256-gcm'/);
  assert.match(crypto, /createDecipheriv\('aes-256-gcm'/);
  assert.match(crypto, /ensureAdminTOTPSecretEncrypted/);
  assert.match(crypto, /\.eq\('id', adminId\)/);
  assert.match(crypto, /updatedRows\.length === 1/);
  assert.match(crypto, /latestProfile, error: latestError/);
  assert.match(crypto, /latestProfile\.two_factor_secret !== null/);
  assert.match(security, /ensureAdminTOTPSecretEncrypted\(supabase, adminId, profile\)/);
  assert.match(security, /refusing to report an unverified state/);
  assert.match(security, /Promise<boolean>/);
});

console.log('NOTE: source-contract checks only. The database rate-limit migration is a candidate and must be applied through the supported Supabase review process before enabling admin 2FA.');
