import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20261019130000_remove_user_metadata_admin_trust_from_trade_rpcs.sql",
);
const sql = readFileSync(migrationPath, "utf8");

for (const signature of [
  "public.mark_p2p_trade_paid(uuid,uuid,text)",
  "public.raise_trade_dispute(uuid,uuid,text)",
  "public.resolve_trade_dispute(uuid,text,uuid,uuid)",
  "public.expire_p2p_trade(uuid)",
  "public.cancel_expired_p2p_trades()",
]) {
  assert.ok(sql.includes(signature), `Missing function signature: ${signature}`);
}
assert.match(sql, /pg_get_functiondef\(v_oid\)/i);
assert.match(sql, /regexp_replace\([\s\S]*?raw_user_meta_data[\s\S]*?'role'[\s\S]*?'admin'[\s\S]*?'FALSE'[\s\S]*?'g'/i);
assert.match(sql, /IF v_hardened = v_definition THEN[\s\S]*?position\('raw_user_meta_data' IN v_definition\)[\s\S]*?RAISE EXCEPTION/i);
assert.match(sql, /EXECUTE v_hardened/i);
assert.match(sql, /IF position\('raw_user_meta_data' IN v_hardened\) > 0 THEN[\s\S]*?RAISE EXCEPTION/i);
assert.match(sql, /BEGIN;[\s\S]*COMMIT;/i);
assert.doesNotMatch(sql, /DROP FUNCTION|REVOKE ALL|GRANT EXECUTE/i);

console.log("PASS: trade RPC user-metadata admin trust migration contract checks");
console.log("NOTE: static checks do not replace PostgreSQL execution and authorization behavior tests.");
