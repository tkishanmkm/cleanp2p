import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync(
  new URL("../supabase/migrations/20261030130000_harden_resolve_trade_dispute_trusted_caller.sql", import.meta.url),
  "utf8",
);

test("resolve_trade_dispute trusted caller fallback is service-role-only", () => {
  assert.match(migration, /public\.resolve_trade_dispute\(uuid,text,uuid,uuid\)/);
  assert.match(migration, /COALESCE\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(migration, /Trusted caller identity is only permitted for service-role execution/);
  assert.match(migration, /regexp_count\(v_definition, v_pattern\) <> 1/);
  assert.match(migration, /EXECUTE v_patched_definition/);
});

test("migration fails closed when installed function shape is unexpected", () => {
  assert.match(migration, /Required dispute RPC is missing/);
  assert.match(migration, /refusing to patch/);
  assert.match(migration, /Expected exactly one caller-ID fallback/);
});
