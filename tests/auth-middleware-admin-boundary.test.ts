import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const middleware = readFileSync('src/middleware.ts', 'utf8');
const adminAuth = readFileSync('src/lib/server-admin-auth.ts', 'utf8');

test('middleware has no placeholder Supabase credentials and fails closed when configuration is missing', () => {
  assert.doesNotMatch(middleware, /placeholder\.supabase\.co|placeholder-anon-key/);
  assert.match(middleware, /NEXT_PUBLIC_SUPABASE_URL\?\.trim\(\)/);
  assert.match(middleware, /NEXT_PUBLIC_SUPABASE_ANON_KEY\?\.trim\(\)/);
  assert.match(middleware, /if \(!supabaseUrl \|\| !supabaseKey\)/);
  assert.match(middleware, /pathname\.startsWith\('\/api\/'\)[\s\S]{0,150}status: 503/);
  assert.match(middleware, /redirectUrl\.searchParams\.set\('error', 'auth_unavailable'\)/);
});

test('middleware only bypasses authentication for routes that authenticate their own machine secret', () => {
  assert.match(middleware, /pathname\.startsWith\('\/api\/webhooks\/'\)/);
  assert.match(middleware, /pathname\.startsWith\('\/api\/cron\/'\)/);
  assert.match(middleware, /pathname\.startsWith\('\/api\/didit\/webhook'\)/);
  assert.match(middleware, /pathname\.startsWith\('\/api\/kyc\/webhook'\)/);
});

test('middleware rejects protected API and page requests when Supabase auth verification throws', () => {
  assert.match(middleware, /Middleware auth verification failed/);
  assert.match(middleware, /Authentication verification is temporarily unavailable[\s\S]{0,80}status: 503/);
  assert.match(middleware, /if \(!isPublicAuthPage && isProtectedPage\)/);
});

test('admin page gate uses active database profile state instead of JWT metadata or an RPC fallback', () => {
  assert.match(middleware, /select\('role, is_admin, is_admin_account, is_banned, is_restricted, is_on_hold, is_suspended, account_status, status'\)/);
  assert.match(middleware, /adminProfileCheck\?\.is_banned !== true/);
  assert.match(middleware, /adminProfileCheck\?\.is_restricted !== true/);
  assert.match(middleware, /adminProfileCheck\?\.is_on_hold !== true/);
  assert.match(middleware, /adminProfileCheck\?\.is_suspended !== true/);
  assert.match(middleware, /if \(!isAdmin\)/);
  assert.doesNotMatch(middleware, /user\.app_metadata\?\.role/);
  assert.doesNotMatch(middleware, /supabase\.rpc\('check_is_admin'/);
});

test('server admin verifier does not trust user-editable metadata or environment email allowlists', () => {
  assert.doesNotMatch(adminAuth, /user\.user_metadata\?\.role/);
  assert.doesNotMatch(adminAuth, /user\.app_metadata\?\.role/);
  assert.doesNotMatch(adminAuth, /ADMIN_EMAILS/);
  assert.match(adminAuth, /is_banned, is_restricted, is_on_hold, is_suspended, account_status, status/);
  assert.match(adminAuth, /profile\.is_banned !== true/);
  assert.match(adminAuth, /profile\.is_restricted !== true/);
  assert.match(adminAuth, /profile\.is_on_hold !== true/);
  assert.match(adminAuth, /profile\.is_suspended !== true/);
  assert.match(adminAuth, /appAdmin\?\.role === "admin"/);
  assert.match(adminAuth, /appAdmin\?\.role === "superadmin"/);
  assert.doesNotMatch(adminAuth, /appAdmin\?\.role === "support"|appAdmin\?\.role === "compliance"/);
  assert.match(adminAuth, /verifyAdmin2FASessionToken/);
});

console.log('PASS: middleware and server admin authorization fail closed and use current database authority.');