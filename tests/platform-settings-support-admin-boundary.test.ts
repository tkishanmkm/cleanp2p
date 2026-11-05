import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const route = readFileSync(join(process.cwd(), "src/app/api/admin/platform-settings/route.ts"), "utf8");
const post = route.slice(route.indexOf("export async function POST"));
assert.match(post, /const auth = await verifyServerAdmin\(req\)/);
assert.match(post, /if \(auth\.supportAdmin === true\)/);
assert.match(post, /Support administrators cannot change global platform settings/);
assert.ok(post.indexOf("if (auth.supportAdmin === true)") < post.indexOf("const body = await req.json()"), "reject support-admin sessions before processing global setting changes");
assert.match(post, /setPlatformSettingKey\(/, "full-admin global-setting writer remains available");
assert.match(post, /rpc\("admin_set_emergency_mode_authorized"/, "full-admin emergency-mode mutation uses server-only RPC");
assert.doesNotMatch(post, /createClient|sessionClient\.rpc/);

console.log("PASS: support-admin sessions are denied global platform-setting writes; verified full admins use the server-only emergency RPC.");
