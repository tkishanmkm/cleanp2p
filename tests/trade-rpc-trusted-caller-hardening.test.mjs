import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(
  join(
    process.cwd(),
    "supabase",
    "migrations",
    "20261030150000_harden_remaining_trade_rpc_caller_fallbacks.sql",
  ),
  "utf8",
);

test("remaining trade RPC caller fallback is restricted to service-role execution", () => {
  assert.match(migration, /public\.release_trade_escrow\(uuid,uuid\)/);
  assert.doesNotMatch(migration, /public\.resolve_trade_dispute\(/);
  assert.match(migration, /20261030130000_harden_resolve_trade_dispute_trusted_caller/);
  assert.match(migration, /COALESCE\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.match(migration, /Trusted caller identity is only permitted for service-role execution/);
  assert.match(migration, /regexp_count\(v_definition, v_pattern\) <> 1/);
  assert.match(migration, /RAISE EXCEPTION/);
  assert.match(migration, /EXECUTE v_patched_definition/);
});

test("migration is idempotent and aborts on missing or unexpected function definitions", () => {
  assert.match(migration, /Required trade RPC is missing/);
  assert.match(migration, /Expected exactly one trusted-caller fallback/);
  assert.match(migration, /position\('Trusted caller identity is only permitted for service-role execution\.' IN v_definition\) > 0/);
  assert.match(migration, /BEGIN;[\s\S]*COMMIT;/);
  assert.doesNotMatch(migration, /supabase db push|supabase migration up|psql\s/i);
});
