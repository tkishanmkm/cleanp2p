import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(
  'supabase/migrations/20261031110000_lock_down_system_settings_access.sql',
  'utf8'
);
const middleware = readFileSync('src/middleware.ts', 'utf8');
const serverSettings = readFileSync('src/lib/platform-settings.ts', 'utf8');

assert.match(sql, /REVOKE ALL PRIVILEGES ON TABLE public\.system_settings FROM PUBLIC, anon, authenticated/i);
assert.match(sql, /GRANT SELECT \(key, value\) ON TABLE public\.system_settings TO anon, authenticated/i);
assert.match(sql, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\.system_settings TO service_role/i);
assert.match(sql, /CREATE POLICY "Public can read platform access flags"[\s\S]*?TO anon, authenticated[\s\S]*?key IN \('emergency_mode', 'maintenance_mode', 'prevent_user_login'\)/i);
assert.match(sql, /DROP POLICY IF EXISTS "system_settings_select_policy"/i);
assert.match(sql, /DROP POLICY IF EXISTS "system_settings_admin_mutate_policy"/i);
assert.doesNotMatch(sql, /SECURITY DEFINER|CREATE OR REPLACE FUNCTION/i);

assert.match(middleware, /\.from\('system_settings'\)/i);
assert.match(middleware, /\.select\('key, value'\)/i);
assert.match(middleware, /\.in\('key', \['emergency_mode', 'maintenance_mode', 'prevent_user_login'\]\)/i);
assert.doesNotMatch(middleware, /\.rpc\('get_platform_access_controls'\)/i);

// All eight operational switches continue to be read server-side with the
// service-role client; the narrower browser allowlist must not break guards.
assert.match(serverSettings, /getSupabaseAdminClient\(\)/);
assert.match(serverSettings, /\.from\("system_settings"\)/);
for (const key of [
  'emergency_mode',
  'prevent_new_trades',
  'prevent_withdrawals',
  'prevent_transfers',
  'prevent_new_ads',
  'prevent_user_login',
  'prevent_new_signups',
  'maintenance_mode',
]) {
  assert.ok(serverSettings.includes('"'+key+'"'), 'Missing server-side platform control: '+key);
}

console.log('PASS: middleware reads only three allowlisted access flags; all eight operational controls remain available to the service-role backend; direct public writes and other public reads are revoked.');
