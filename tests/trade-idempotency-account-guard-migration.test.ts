import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20261019140000_block_disabled_account_idempotency_replay.sql",
);
const sql = readFileSync(migrationPath, "utf8");

assert.match(sql, /to_regprocedure\s*\(/i);
assert.match(sql, /public\.initiate_trade_with_escrow\(text,numeric,numeric,text,numeric,text,text,text,uuid\)/i);
assert.match(sql, /pg_get_functiondef\(v_oid\)/i);
assert.match(sql, /v_marker_count <> 1/i);
assert.match(sql, /-- 1\.1 Strict Idempotency Key Validation/);
assert.match(sql, /v_early_section/);
assert.match(sql, /TRADE_INITIATION_ACCOUNT_DISABLED/);
assert.match(sql, /COALESCE\(p\.is_banned, false\) = false/i);
assert.match(sql, /COALESCE\(p\.is_restricted, false\) = false/i);
assert.match(sql, /COALESCE\(p\.is_suspended, false\) = false/i);
assert.match(sql, /COALESCE\(p\.is_minor_restricted, false\) = false/i);
assert.match(sql, /p\.account_status IS NOT NULL/i);
assert.match(sql, /LOWER\(BTRIM\(p\.account_status\)\) = 'active'/i);
assert.match(sql, /LOWER\(COALESCE\(p\.status::text, ''\)\) = 'active'/i);
assert.match(sql, /EXECUTE v_hardened/i);
assert.match(sql, /BEGIN;[\s\S]*COMMIT;/i);

console.log("PASS: disabled-account idempotency replay migration contract checks");
console.log("NOTE: static checks do not replace PostgreSQL execution or authorization regression tests.");
