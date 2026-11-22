import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20261019080000_guard_trade_participant_account_status.sql",
);
const sql = readFileSync(migrationPath, "utf8");

assert.match(sql, /CREATE OR REPLACE FUNCTION public\.guard_trade_participant_account_status\(\)/i);
assert.match(sql, /SECURITY DEFINER\s+SET search_path = ''/i);
assert.match(sql, /FOREACH v_participant_id IN ARRAY/i);
assert.match(sql, /WHERE p\.id::text = v_participant_id/i);
assert.match(sql, /TRADE_PARTICIPANT_UNVERIFIED/i);
assert.match(sql, /TRADE_PARTICIPANT_ACCOUNT_DISABLED/i);
assert.match(sql, /COALESCE\(v_is_banned, false\)/i);
assert.match(sql, /COALESCE\(v_is_restricted, false\)/i);
assert.match(sql, /COALESCE\(v_is_suspended, false\)/i);
assert.match(sql, /COALESCE\(v_is_minor_restricted, false\)/i);
assert.match(sql, /v_account_status IS NULL/i);
assert.match(sql, /LOWER\(btrim\(v_account_status\)\) <> 'active'/i);
assert.match(sql, /CREATE TRIGGER a_guard_trade_participant_account_status\s+BEFORE INSERT ON public\.trades/i);
assert.match(sql, /REVOKE ALL ON FUNCTION public\.guard_trade_participant_account_status\(\)\s+FROM PUBLIC, anon, authenticated/i);
assert.match(sql, /BEGIN;[\s\S]*COMMIT;/i);

console.log("PASS: trade participant account-status migration contract checks");
console.log("NOTE: static checks do not replace PostgreSQL execution or live regression tests.");
