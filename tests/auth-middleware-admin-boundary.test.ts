import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const middleware = readFileSync('src/middleware.ts', 'utf8');
const adminAuth = readFileSync('src/lib/server-admin-auth.ts', 'utf8');

test('middleware trims Supabase config and fails closed when config is absent', () => {
  assert.ok(middleware.includes('process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()'));
  assert.ok(middleware.includes('process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()'));
  assert.ok(middleware.includes('AUTH_SERVICE_NOT_CONFIGURED'));
  assert.ok(middleware.includes('status: 503'));
});

test('middleware bypasses only handlers that authenticate their own machine secret', () => {
  assert.ok(middleware.includes("pathname.startsWith('/api/webhooks/')"));
  assert.ok(middleware.includes("pathname.startsWith('/api/cron/')"));
  assert.ok(middleware.includes("pathname.startsWith('/api/didit/webhook')"));
  assert.ok(middleware.includes("pathname.startsWith('/api/kyc/webhook')"));
});

test('middleware fails closed when authentication/network enforcement throws', () => {
  assert.ok(middleware.includes('Middleware authentication enforcement failed:'));
  assert.ok(middleware.includes('AUTH_SERVICE_UNAVAILABLE'));
  assert.ok(middleware.includes('Authentication service is temporarily unavailable.'));
  assert.ok(middleware.includes("loginUrl.searchParams.set('error', 'authentication_unavailable')"));
});

test('admin middleware requires canonical database verification, not JWT role metadata', () => {
  const start = middleware.indexOf('const isAdminRoute =');
  assert.ok(start >= 0);
  const adminGate = middleware.slice(start);
  assert.ok(adminGate.includes('verify_admin_login'));
  assert.ok(adminGate.includes('verificationResult?.[0]?.is_valid === true'));
  assert.ok(adminGate.includes('ADMIN_VERIFICATION_UNAVAILABLE'));
  assert.ok(!adminGate.includes('user.app_metadata?.role'));
  assert.ok(!adminGate.includes("supabase.rpc('check_is_admin'"));
});

test('server admin verifier checks durable profile state, canonical RPC and signed 2FA', () => {
  assert.ok(!adminAuth.includes('user.user_metadata?.role'));
  assert.ok(!adminAuth.includes('user.app_metadata?.role'));
  assert.ok(!adminAuth.includes('ADMIN_EMAILS'));
  assert.ok(adminAuth.includes('from("profiles")'));
  assert.ok(adminAuth.includes('verify_admin_login'));
  assert.ok(adminAuth.includes('is_valid === true'));
  assert.ok(adminAuth.includes('support_admin_grants'));
  assert.ok(adminAuth.includes('verifyAdmin2FASessionToken'));
});
