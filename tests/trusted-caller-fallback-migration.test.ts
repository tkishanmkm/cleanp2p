import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migrationPath = join(
  process.cwd(),
  "supabase",
  "migrations",
  "20261019100100_restrict_trusted_caller_id_fallback_to_service_role.sql",
);
const migration = readFileSync(migrationPath, "utf8");

test("hardens every trade RPC that accepts a caller-supplied identity", () => {
  const signatures = [
    "public.initiate_trade_with_escrow(text,numeric,numeric,text,numeric,text,text,text,uuid)",
    "public.mark_p2p_trade_paid(uuid,uuid,text)",
    "public.cancel_p2p_trade(uuid,uuid,text)",
    "public.raise_trade_dispute(uuid,uuid,text)",
  ];

  for (const signature of signatures) {
    assert.ok(migration.includes(signature), `missing target function: ${signature}`);
  }
  assert.match(migration, /regexp_count\(v_definition, v_pattern\) <> 1/);
  assert.match(migration, /COALESCE\(auth\.role\(\), ''\) <> 'service_role'/);
  assert.doesNotMatch(migration, /current_setting\(['"]role['"]/);
  assert.match(migration, /USING ERRCODE = '42501'/);
  assert.match(migration, /EXECUTE v_patched_definition/);
});

test("fails closed if the expected function shape has drifted", () => {
  assert.match(migration, /Required trade RPC is missing/);
  assert.match(migration, /Expected exactly one trusted-caller fallback/);
  assert.match(migration, /Trusted-caller hardening made no change/);
});
