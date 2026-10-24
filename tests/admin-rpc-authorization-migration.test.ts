import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20261024000004_admin_rpc_authorization_hardening.sql'),
  'utf8',
);

assert.ok(migration.includes('v_uid <> v_auth_uid'), 'admin status lookup must reject another UUID for authenticated callers');
assert.ok(migration.includes("auth.role() IS DISTINCT FROM 'service_role'"), 'unauthenticated callers must not probe admin status');
assert.ok(migration.includes('raw_app_meta_data'), 'server-managed app metadata check must remain available');
assert.ok(migration.includes('public.app_admins'), 'canonical admin registry check must remain available');
assert.ok(migration.includes('raw_user_meta_data\\\\s*->>'), 'migration must target user-editable admin metadata clauses');
assert.ok(migration.includes('Could not safely remove user-editable admin metadata clause'), 'migration must fail closed if its patch does not match');
assert.ok(migration.includes('p_caller_id\\\\s+IS\\\\s+NULL'), 'paid-trade caller fallback must be matched explicitly');
assert.ok(migration.includes('p_user_id\\\\s+IS\\\\s+NULL'), 'dispute caller fallback must be matched explicitly');
assert.equal(
  (migration.match(/Trusted service caller ID is required\\./g) ?? []).length,
  2,
  'both trade RPCs must restrict null-session identity fallback to a trusted service role',
);
assert.ok(migration.includes('Could not safely harden null-session identity fallback'), 'migration must fail closed if either identity patch does not match');
assert.ok(migration.includes('REVOKE EXECUTE ON FUNCTION public.verify_admin_login(uuid, uuid) FROM PUBLIC, anon'), 'anonymous role probing must be revoked');

console.log('Admin RPC authorization migration source guards passed.');
