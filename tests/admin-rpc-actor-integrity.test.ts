import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const roleMigration = readFileSync(join(root, "supabase/migrations/20261026120100_bind_admin_role_audit_actor.sql"), "utf8");
const bulkActorMigration = readFileSync(join(root, "supabase/migrations/20261025070000_harden_bulk_admin_audit_actor.sql"), "utf8");
const bulkAclMigration = readFileSync(join(root, "supabase/migrations/20261026131000_restrict_bulk_account_control_rpc_acl.sql"), "utf8");
const freezeMigration = readFileSync(join(root, "supabase/migrations/20261026124500_harden_emergency_freeze_actor.sql"), "utf8");
const emergencyMigration = readFileSync(join(root, "supabase/migrations/20261026123000_harden_emergency_mode_actor.sql"), "utf8");

test("admin role update RPC is server-only so direct authenticated calls cannot bypass the route 2FA gate", () => {
  assert.match(roleMigration, /REVOKE ALL ON FUNCTION public\.admin_update_user_role\(uuid, uuid, text\) FROM PUBLIC, anon, authenticated/i);
  assert.match(roleMigration, /GRANT EXECUTE ON FUNCTION public\.admin_update_user_role\(uuid, uuid, text\) TO service_role, postgres/i);
  assert.doesNotMatch(roleMigration, /GRANT EXECUTE ON FUNCTION public\.admin_update_user_role[^;]*TO authenticated/i);
});

test("bulk account-control RPCs are service-role only and their actor guard is explicit", () => {
  for (const name of ["execute_bulk_ban_atomic", "execute_bulk_unban_atomic", "execute_bulk_restrict_atomic", "execute_bulk_unrestrict_atomic"]) {
    assert.match(bulkAclMigration, new RegExp("REVOKE ALL ON FUNCTION public\\." + name + "\\("));
    assert.match(bulkAclMigration, new RegExp("GRANT EXECUTE ON FUNCTION public\\." + name + "[\\s\\S]*?TO service_role, postgres"));
  }
  assert.match(bulkActorMigration, /v_effective_admin_id := p_admin_id/);
  assert.match(bulkActorMigration, /explicit auditable actor ID/);
  assert.match(bulkActorMigration, /canonical profile email/i);
  assert.match(bulkActorMigration, /Admin actor email does not match the canonical profile email/);
  assert.match(bulkActorMigration, /p_admin_id IS DISTINCT FROM v_effective_admin_id/);
});

test("emergency, freeze and unfreeze mutation RPCs are no longer directly executable by authenticated clients", () => {
  assert.match(emergencyMigration, /REVOKE ALL ON FUNCTION public\.admin_set_emergency_mode\(BOOLEAN, TEXT\)\s+FROM PUBLIC, anon, authenticated, service_role/i);
  assert.match(emergencyMigration, /admin_set_emergency_mode_authorized\(BOOLEAN, TEXT, UUID, TEXT\)/);
  assert.match(emergencyMigration, /TO service_role, postgres/i);

  for (const name of ["admin_freeze_user", "admin_unfreeze_user"]) {
    assert.match(freezeMigration, new RegExp("REVOKE ALL ON FUNCTION public\\." + name + "\\(UUID, TEXT\\)\\s+FROM PUBLIC, anon, authenticated, service_role", "i"));
    assert.match(freezeMigration, new RegExp(name + "_authorized\\(UUID, TEXT, UUID, TEXT\\)"));
  }
  assert.match(freezeMigration, /TO service_role, postgres/i);
});
