import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20261019110000_harden_verify_admin_login_identity.sql",
);
const sql = readFileSync(migrationPath, "utf8");

assert.match(sql, /CREATE OR REPLACE FUNCTION public\.verify_admin_login\s*\(\s*p_user_uuid uuid DEFAULT NULL,\s*user_uuid uuid DEFAULT NULL\s*\)/i);
assert.match(sql, /RETURNS TABLE\s*\(\s*is_valid boolean,\s*role_val text,\s*suspended_val boolean,\s*error_msg text\s*\)/i);
assert.match(sql, /IF NOT v_is_service_role THEN[\s\S]*?IF v_caller_id IS NULL THEN[\s\S]*?Authentication required/i);
assert.match(sql, /p_user_uuid IS NOT NULL AND p_user_uuid <> v_caller_id/i);
assert.match(sql, /user_uuid IS NOT NULL AND user_uuid <> v_caller_id/i);
assert.match(sql, /LOWER\(COALESCE\(p\.status::text, ''\)\) IN \('suspended', 'on_hold', 'hold'\)/i);
assert.match(sql, /UPPER\(COALESCE\(p\.account_status::text, ''\)\) IN \('SUSPENDED', 'ON_HOLD', 'HOLD'\)/i);
assert.match(sql, /UPPER\(COALESCE\(p\.account_status::text, ''\)\) = 'BANNED'/i);
assert.match(sql, /UPPER\(COALESCE\(p\.account_status::text, ''\)\) IN \('DELETED', 'DELETION_PENDING'\)/i);
assert.match(sql, /v_is_banned OR v_is_suspended OR v_is_deleted/i);
assert.match(sql, /v_is_service_role boolean := COALESCE\(auth\.role\(\) = 'service_role', false\)/i);
assert.doesNotMatch(sql, /current_setting\('role', true\)/i);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.verify_admin_login\(uuid, uuid\) FROM PUBLIC, anon/i);
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.verify_admin_login\(uuid, uuid\) TO authenticated, service_role, postgres/i);
assert.doesNotMatch(sql, /km8870960@gmail\.com|muralikrishna01051996@gmail\.com/i);

console.log("PASS: verify_admin_login migration contract checks");
console.log("NOTE: static contract checks do not replace execution against an isolated PostgreSQL database.");
