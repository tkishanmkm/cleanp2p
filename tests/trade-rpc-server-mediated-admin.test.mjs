import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261031111719_require_server_mediated_admin_trade_actions.sql"),
  "utf8",
);

test("participant RPC administrator exception is service-role JWT only", () => {
  for (const signature of [
    "public.cancel_p2p_trade(uuid,uuid,text)",
    "public.mark_p2p_trade_paid(uuid,uuid,text)",
    "public.raise_trade_dispute(uuid,uuid,text)",
  ]) {
    assert.ok(migration.includes(signature), "missing RPC target: " + signature);
  }
  assert.match(migration, /regexp_count\(v_definition, v_pattern, 1, 'i'\) <> 1/i);
  assert.match(migration, /v_is_admin := COALESCE\(auth\.jwt\(\) ->> ''role'', ''''\) = ''service_role''/i);
  assert.match(migration, /Expected one administrator predicate/i);
  assert.match(migration, /EXECUTE v_patched_definition/i);
});

test("admin mark-paid wrapper is atomic, audited, and service-role-only", () => {
  assert.match(migration, /CREATE OR REPLACE FUNCTION public\.admin_mark_trade_paid_authorized\(\s*p_trade_id UUID,\s*p_actor_id UUID,\s*p_actor_email TEXT,\s*p_reason TEXT/i);
  assert.match(migration, /SECURITY DEFINER\s+SET search_path = ''/i);
  assert.match(migration, /COALESCE\(auth\.jwt\(\) ->> 'role', ''\) <> 'service_role'/i);
  assert.match(migration, /FROM auth\.users AS u\s+WHERE u\.id = p_actor_id/i);
  assert.match(migration, /SELECT t\.buyer_id::UUID, t\.payment_method/);
  assert.match(migration, /public\.mark_p2p_trade_paid\(\s*p_trade_id,\s*p_actor_id,\s*v_payment_method\s*\)/i);
  assert.match(migration, /INSERT INTO public\.admin_audit_logs/);
  assert.match(migration, /'ADMIN_MARKED_TRADE_PAID'/);
  assert.match(migration, /'reason', v_clean_reason/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_mark_trade_paid_authorized\(UUID, UUID, TEXT, TEXT\)\s+FROM PUBLIC, anon, authenticated, service_role/i);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_mark_trade_paid_authorized\(UUID, UUID, TEXT, TEXT\)\s+TO service_role, postgres/i);
  assert.doesNotMatch(migration, /GRANT EXECUTE[^;]*TO authenticated/i);
});

console.log("PASS: participant trade RPC admin branch is server-role-only; admin mark-paid wrapper atomically writes audit evidence.");
