import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const middleware = readFileSync(join(process.cwd(), "src/middleware.ts"), "utf8");

assert.match(middleware, /error: sysSettingsError/);
assert.match(middleware, /emergencySettingAvailable/);
assert.match(middleware, /sysSettingsError \|\| !emergencySettingAvailable/);
assert.match(middleware, /PLATFORM_CONTROL_STATE_UNAVAILABLE/);
assert.match(middleware, /platform_controls_unavailable/);
assert.match(middleware, /Platform emergency control enforcement failed/);

console.log("PASS: middleware fails closed when platform emergency controls are missing or unavailable.");
console.log("NOTE: static source-contract test only; request-level behavior requires integration testing.");
