import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "src/middleware.ts"), "utf8");
const adminStart = source.indexOf("const isAdminRoute =");
const adminEnd = source.indexOf("// 4. Admin 2FA Enforcement Gate", adminStart);
const adminBlock = source.slice(adminStart, adminEnd);

test("admin middleware uses the canonical verify_admin_login RPC", () => {
  assert.match(adminBlock, /supabase\.rpc\(\s*'verify_admin_login'/);
  assert.match(adminBlock, /verificationResult\?\.\[0\]\?\.is_valid === true/);
});

test("admin middleware fails closed when canonical verification is unavailable", () => {
  assert.match(adminBlock, /if \(verificationError\)/);
  assert.match(adminBlock, /ADMIN_VERIFICATION_UNAVAILABLE/);
  assert.match(adminBlock, /status: 503/);
  assert.doesNotMatch(adminBlock, /rpc\('check_is_admin'/);
});

test("admin middleware does not authorize from metadata or profile flags alone", () => {
  assert.doesNotMatch(adminBlock, /user\.app_metadata\?\.role/);
  assert.doesNotMatch(adminBlock, /select\('role, is_admin'\)/);
});
