import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const migration = readFileSync(
  'supabase/migrations/20261031113546_align_user_2fa_status_flag_logic.sql',
  'utf8',
);
const appStatusRoute = readFileSync(
  'src/app/api/auth/2fa/status/route.ts',
  'utf8',
);

test('2FA status RPC ORs all current and legacy enabled flags', () => {
  assert.match(migration, /COALESCE\(p\.is_2fa_enabled,\s*FALSE\)\s+OR\s+COALESCE\(p\.is_mfa_enabled,\s*FALSE\)\s+OR\s+COALESCE\(p\.two_factor_enabled,\s*FALSE\)/i);
  assert.doesNotMatch(migration, /COALESCE\s*\(\s*p\.is_2fa_enabled\s*,\s*p\.is_mfa_enabled/i);
  assert.match(appStatusRoute, /profile\?\.is_2fa_enabled\s*\|\|\s*profile\?\.is_mfa_enabled\s*\|\|\s*profile\?\.two_factor_enabled/i);
});

test('2FA status RPC remains self-scoped unless the caller is a trusted admin or service role', () => {
  assert.match(migration, /v_caller_id := auth\.uid\(\)/i);
  assert.match(migration, /p_user_id IS NOT NULL[\s\S]*?v_caller_id IS NULL OR p_user_id <> v_caller_id/i);
  assert.match(migration, /auth\.role\(\) IS DISTINCT FROM 'service_role'/i);
  assert.match(migration, /current_setting\('role', true\) IS DISTINCT FROM 'service_role'/i);
  assert.match(migration, /NOT public\.is_admin\(\)/i);
  assert.match(migration, /RETURN COALESCE\(v_is_enabled, FALSE\)/i);
});

test('2FA status RPC has a fixed empty search path and no anonymous/public execute grant', () => {
  assert.match(migration, /SECURITY DEFINER\s+SET search_path = ''/i);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.get_user_2fa_status\(uuid\)\s+FROM PUBLIC, anon/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.get_user_2fa_status\(uuid\)\s+TO authenticated, service_role, postgres/i);
});