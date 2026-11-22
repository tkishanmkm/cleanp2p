import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261025070000_harden_bulk_admin_audit_actor.sql"),
  "utf8"
);
const route = readFileSync(
  join(process.cwd(), "src/app/api/admin/platform-controls/bulk/route.ts"),
  "utf8"
);

test("bulk admin actor migration targets all four exact RPC signatures and fails closed", () => {
  for (const name of [
    "execute_bulk_ban_atomic",
    "execute_bulk_unban_atomic",
    "execute_bulk_restrict_atomic",
    "execute_bulk_unrestrict_atomic",
  ]) {
    assert.ok(migration.includes(`public.${name}(`), `missing target ${name}`);
  }
  assert.match(migration, /Required bulk admin RPC not found/);
  assert.match(migration, /Expected DECLARE block not found/);
  assert.match(migration, /Refusing to patch .* twice/);
});

test("authenticated audit actor must match session identity and canonical email", () => {
  assert.match(migration, /v_effective_admin_id := auth\.uid\(\)/);
  assert.match(migration, /p_admin_id IS DISTINCT FROM v_effective_admin_id/);
  assert.match(migration, /Admin actor email does not match authenticated user/);
  assert.match(migration, /auth\.role\(\) = 'service_role'/);
  assert.match(migration, /explicit auditable actor ID/);
  assert.match(migration, /replace\(v_body, 'p_admin_id', 'v_effective_admin_id'\)/);
  assert.match(migration, /replace\(v_body, 'p_admin_email', 'v_effective_admin_email'\)/);
});

test("service-role RPC audit email prefers the target profile's canonical email", () => {
  const serviceBranch = migration.split("IF auth.role() = 'service_role' THEN")[1]?.split("ELSE")[0] ?? "";
  assert.match(serviceBranch, /v_effective_admin_id := p_admin_id/);
  assert.match(serviceBranch, /SELECT NULLIF\(btrim\(p\.email\), ''\) INTO v_effective_admin_email[\s\S]*?FROM public\.profiles p[\s\S]*?WHERE p\.id = v_effective_admin_id/i);
  assert.match(serviceBranch, /Admin actor email does not match the canonical profile email/);
  assert.match(serviceBranch, /COALESCE\([\s\S]*?v_effective_admin_email[\s\S]*?NULLIF\(btrim\(p_admin_email\), ''\)/i);
});

test("bulk API derives identity from verified server auth and blocks support-admin bulk execution", () => {
  assert.match(route, /verifyServerAdmin\(req\)/);
  assert.match(route, /if \(!auth\.authorized\)/);
  assert.match(route, /auth\.supportAdmin === true/);
  assert.match(route, /const adminId = auth\.adminId \|\| auth\.user\.id/);
  assert.match(route, /const adminEmail = auth\.adminEmail \|\| ""/);
  assert.doesNotMatch(route, /admin@paxones\.com|body\.admin_id|body\.admin_email/i);
});
