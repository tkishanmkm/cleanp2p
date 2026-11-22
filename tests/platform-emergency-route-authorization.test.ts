import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "src/app/api/admin/platform-settings/route.ts"),
  "utf8",
);

assert.match(source, /const auth = await verifyServerAdmin\(req\)/);
assert.match(source, /if \(!auth\.authorized\)/);
assert.match(source, /if \(key === "emergency_mode"\)/);
assert.match(source, /getSupabaseAdminClient\(\)/);
assert.match(source, /adminClient\.rpc\("admin_set_emergency_mode_authorized"/);
assert.match(source, /p_enabled: boolVal/);
assert.match(source, /p_reason: reason \?\? null/);
assert.match(source, /p_actor_id: adminId/);
assert.match(source, /p_actor_email: adminEmail \|\| null/);
assert.match(source, /body\.emergency_mode === true && \(!reason \|\| reason\.length < 3\)/);
assert.doesNotMatch(source, /createClient|sessionClient\.rpc\("admin_set_emergency_mode"/);

const emergencyBranch = source.split('if (key === "emergency_mode")')[1]?.split("} else {")[0] ?? "";
assert.ok(emergencyBranch.length > 0, "emergency mode must have a dedicated branch");
assert.doesNotMatch(emergencyBranch, /setPlatformSettingKey\(/, "emergency mode must use the dedicated server-only mutation RPC");
assert.match(emergencyBranch, /if \(error \|\| !data \|\| data\.success !== true\)/);

console.log("PASS: emergency-mode route verifies admin/2FA and sends actor identity through the server-only RPC.");
