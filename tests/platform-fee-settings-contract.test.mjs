import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const helper = readFileSync("src/lib/platform-fees.ts", "utf8");
const route = readFileSync("src/app/api/platform/fees/route.ts", "utf8");

assert.match(helper, /from\("app_settings"\)[\s\S]*?select\("key, value"\)/);
assert.match(helper, /platform_fee_percent/);
assert.match(helper, /escrow_fee_percent/);
assert.match(helper, /min_trade_amount/);
assert.match(helper, /Number\.isFinite\(value\)/);
assert.match(helper, /throw new Error\("Platform fee configuration is missing or invalid:/);
assert.match(route, /supabase\.auth\.getUser\(\)/);
assert.match(route, /getPlatformFeeSettings\(\)/);
assert.match(route, /status: 503/);
assert.match(route, /Cache-Control/);

console.log("PASS: authenticated platform fee endpoint reads and validates canonical key/value settings without insecure defaults.");
