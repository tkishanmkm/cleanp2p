import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const migration = readFileSync(
  join(process.cwd(), "supabase/migrations/20261026123000_harden_emergency_mode_actor.sql"),
  "utf8",
);
const route = readFileSync(
  join(process.cwd(), "src/app/api/admin/platform-settings/route.ts"),
  "utf8",
);

assert.match(migration, /REVOKE ALL ON FUNCTION public\.admin_set_emergency_mode\(BOOLEAN, TEXT\)\s+FROM PUBLIC, anon, authenticated, service_role/i);
assert.match(migration, /CREATE OR REPLACE FUNCTION public\.admin_set_emergency_mode_authorized\(\s*p_enabled BOOLEAN,\s*p_reason TEXT,\s*p_actor_id UUID,\s*p_actor_email TEXT/i);
assert.match(migration, /auth\.role\(\) IS DISTINCT FROM 'service_role'/i);
assert.match(migration, /p_actor_id IS NULL/);
assert.match(migration, /FROM public\.profiles AS p\s+WHERE p\.id = p_actor_id/i);
assert.match(migration, /Administrator email does not match the canonical profile email/);
assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.admin_set_emergency_mode_authorized\(BOOLEAN, TEXT, UUID, TEXT\)\s+TO service_role, postgres/i);
assert.doesNotMatch(migration, /GRANT EXECUTE[^;]*TO authenticated/i);

assert.match(route, /const auth = await verifyServerAdmin\(req\)/);
assert.match(route, /if \(auth\.supportAdmin === true\)/);
assert.match(route, /getSupabaseAdminClient\(\)/);
assert.match(route, /adminClient\.rpc\("admin_set_emergency_mode_authorized"/);
assert.match(route, /p_actor_id: adminId/);
assert.match(route, /p_actor_email: adminEmail \|\| null/);
assert.doesNotMatch(route, /createClient|sessionClient\.rpc\("admin_set_emergency_mode"/);

console.log("PASS: emergency-mode RPC is server-only; route verifies the signed admin session and sends verified actor fields.");
