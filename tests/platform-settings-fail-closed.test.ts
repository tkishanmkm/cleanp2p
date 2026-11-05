import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const settingsSource = readFileSync(join(process.cwd(), "src/lib/platform-settings.ts"), "utf8");
const guardSource = readFileSync(join(process.cwd(), "src/lib/platform-guard.ts"), "utf8");

// Security regression contract: a failed/missing settings read must not silently
// become permissive defaults, because callers use these flags to gate financial actions.
assert.doesNotMatch(
  settingsSource,
  /return\s+cachedSettings\s*\|\|\s*DEFAULT_SETTINGS/,
  "Platform control reads must throw on database errors instead of returning permissive defaults."
);

for (const key of [
  "emergency_mode",
  "maintenance_mode",
  "prevent_new_trades",
  "prevent_withdrawals",
  "prevent_transfers",
  "prevent_new_ads",
  "prevent_user_login",
  "prevent_new_signups",
]) {
  assert.match(
    settingsSource,
    new RegExp(`["']${key}["']`),
    `Required platform control "${key}" must be explicitly validated.`
  );
}

assert.match(guardSource, /PLATFORM_SERVICE_UNAVAILABLE/);
console.log("PASS: platform-control settings source meets the fail-closed regression contract.");
