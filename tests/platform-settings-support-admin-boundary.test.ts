import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const route = readFileSync(join(process.cwd(), "src/app/api/admin/platform-settings/route.ts"), "utf8");
const get = route.slice(route.indexOf("export async function GET"));
const post = route.slice(route.indexOf("export async function POST"));

assert.match(post, /const auth = await verifyServerAdmin\(req\)/);
assert.match(post, /if \(auth\.supportAdmin === true\)/);
assert.match(post, /Support administrators cannot change global platform settings/);
assert.ok(post.indexOf("if (auth.supportAdmin === true)") < post.indexOf("const body = await req.json()"), "support-admin session is denied before parsing global control changes");
assert.match(post, /rpc\(\s*"admin_set_platform_controls_authorized"/, "full admins use the canonical atomic platform-controls RPC");
assert.match(post, /p_actor_id: adminId/);
assert.match(post, /p_actor_email: adminEmail/);
assert.match(post, /updateResult\.success !== true/);
assert.match(post, /Platform controls could not be updated and audited/);
assert.doesNotMatch(post, /setPlatformSettingKey\(|admin_set_emergency_mode_authorized|sessionClient\.rpc/);
assert.match(get, /canReadFullAdminSettings/);
assert.match(get, /auth\.supportAdmin !== true && auth\.supportReadOnly !== true/);
assert.match(get, /emergency_mode:[\s\S]*maintenance_mode:/);

console.log("PASS: support-admin sessions are denied global platform-setting writes; full admins use the atomic server-only controls RPC.");
