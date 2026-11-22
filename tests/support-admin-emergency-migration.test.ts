import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20261026100000_support_admin_emergency_mode.sql"),
  "utf8",
);

assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.support_admin_grants/i);
assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.support_admin_emergency_sessions/i);
assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.support_admin_activity/i);
assert.match(sql, /emergency_uses_remaining integer NOT NULL DEFAULT 0 CHECK \(emergency_uses_remaining >= 0\)/i);
assert.match(sql, /expires_at <= activated_at \+ interval '3 hours'/i);
assert.match(sql, /p_two_factor_verified_at < v_activated_at - interval '90 seconds'/i);
assert.match(sql, /p_two_factor_verified_at > v_activated_at \+ interval '10 seconds'/i);
assert.match(sql, /emergency_uses_remaining = emergency_uses_remaining - 1/i);
assert.match(sql, /emergency_uses_consumed = emergency_uses_consumed \+ 1/i);
assert.match(sql, /COALESCE\(auth\.role\(\), ''\) <> 'service_role'/i);
assert.match(sql, /SET search_path = ''/i);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.activate_support_admin_emergency\(uuid, timestamptz\) FROM PUBLIC, anon, authenticated/i);
assert.doesNotMatch(sql, /WHERE revoked_at IS NULL AND expires_at > now\(\)/i);
console.log("PASS: support-admin emergency migration static contract checks");
console.log("NOTE: static checks do not replace applying the migration to a schema-matched disposable PostgreSQL database.");
