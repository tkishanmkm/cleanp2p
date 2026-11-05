import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261026124500_harden_emergency_freeze_actor.sql"),
  "utf8",
);
const actions = readFileSync(
  join(process.cwd(), "src/app/adminnarayan/users/actions.ts"),
  "utf8",
);

for (const fn of ["admin_freeze_user", "admin_unfreeze_user"]) {
  assert.match(migration, new RegExp("REVOKE ALL ON FUNCTION public\\." + fn + "\\(UUID, TEXT\\)\\s+FROM PUBLIC, anon, authenticated, service_role", "i"));
  assert.match(migration, new RegExp("CREATE OR REPLACE FUNCTION public\\." + fn + "_authorized\\(\\s*p_target_user_id UUID,\\s*p_reason TEXT,\\s*p_actor_id UUID,\\s*p_actor_email TEXT", "i"));
  assert.match(migration, new RegExp("REVOKE ALL ON FUNCTION public\\." + fn + "_authorized\\(UUID, TEXT, UUID, TEXT\\)"));
  assert.match(migration, new RegExp("GRANT EXECUTE ON FUNCTION public\\." + fn + "_authorized\\(UUID, TEXT, UUID, TEXT\\)\\s+TO service_role, postgres"));
}
assert.equal((migration.match(/auth\.role\(\) IS DISTINCT FROM 'service_role'/g) || []).length, 2);
assert.equal((migration.match(/p_actor_id IS NULL/g) || []).length, 2);
assert.equal((migration.match(/FROM public\.profiles AS p/g) || []).length, 2);
assert.doesNotMatch(migration, /GRANT EXECUTE[^;]*TO authenticated/i);

assert.match(actions, /verifyServerAdmin\(\)/);
assert.equal((actions.match(/auth\.supportAdmin === true/g) || []).length, 5);
assert.match(actions, /adminSupabase\.rpc\("admin_freeze_user_authorized"/);
assert.match(actions, /adminSupabase\.rpc\("admin_unfreeze_user_authorized"/);
assert.equal((actions.match(/p_actor_id: auth\.adminId/g) || []).length, 2);
assert.equal((actions.match(/p_actor_email: auth\.adminEmail \?\? null/g) || []).length, 2);
assert.doesNotMatch(actions, /createClient|sessionSupabase\.rpc\("admin_(?:freeze|unfreeze)_user"/);
assert.match(actions, /Emergency freeze was not confirmed by the database/);
assert.match(actions, /Emergency unfreeze was not confirmed by the database/);
assert.match(actions, /cleanReason\.length < 3/);

console.log("PASS: freeze/unfreeze mutation RPCs are server-only; actions verify the signed admin session, reject support-admin sessions, and pass verified actor fields.");
