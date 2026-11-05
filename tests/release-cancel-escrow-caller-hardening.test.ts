import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "20261019170000_harden_release_cancel_escrow_rpc_auth.sql"),
  "utf8",
);

for (const signature of [
  "public.release_trade_escrow(uuid,uuid)",
  "public.cancel_p2p_trade(uuid,uuid,text)",
]) assert.ok(sql.includes(signature), `missing RPC target: ${signature}`);

assert.match(sql, /pg_get_functiondef\(v_oid\)/i);
assert.match(sql, /already hardens cancel_p2p_trade/i);
assert.match(sql, /CONTINUE;/i);
assert.match(sql, /Unexpected duplicate trusted-caller guards/i);
assert.match(sql, /regexp_count\(v_definition, v_pattern\) <> 1/i);
assert.match(sql, /RAISE EXCEPTION '\[\^'\]\*'/);
assert.match(sql, /COALESCE\(auth\.role\(\), ''\) <> 'service_role'/i);
assert.match(sql, /IS DISTINCT FROM v_auth_uid/i);
assert.doesNotMatch(sql, /current_user\s*(?:NOT IN|=|<>)/i);
assert.doesNotMatch(sql, /raw_user_meta_data/i);
assert.match(sql, /EXECUTE v_patched/i);
assert.match(sql, /BEGIN;[\s\S]*COMMIT;/i);
console.log("PASS: escrow caller hardening migration contract checks");
console.log("NOTE: static checks do not replace PostgreSQL execution and authorization behavior tests.");


test("ordered caller-hardening migrations tolerate the already-patched cancel RPC", () => {
  const prior = readFileSync(
    join(process.cwd(), "supabase", "migrations", "20261019100100_restrict_trusted_caller_id_fallback_to_service_role.sql"),
    "utf8",
  );
  assert.match(prior, /public\.cancel_p2p_trade\(uuid,uuid,text\)/);
  assert.match(prior, /COALESCE\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(sql, /earlier trusted-caller migration already hardens cancel_p2p_trade/i);
  assert.match(sql, /position\('Trusted caller identity is only permitted for service-role execution\.' IN v_definition\) > 0/);
  assert.match(sql, /CONTINUE;/i);
  assert.match(sql, /Unexpected duplicate trusted-caller guards/i);
  assert.match(sql, /public\.release_trade_escrow\(uuid,uuid\)/);
});
