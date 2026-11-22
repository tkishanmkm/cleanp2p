import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "src/app/adminnarayan/admin-shell.tsx"),
  "utf8"
);
const effectStart = source.indexOf("async function verifyClientAdmin()");
const effectEnd = source.indexOf("verifyClientAdmin();", effectStart);
const verification = source.slice(effectStart, effectEnd);

test("admin shell verifies full admins with getUser and the canonical RPC", () => {
  assert.match(verification, /supabase\.auth\.getUser\(\)/);
  assert.match(verification, /supabase\.rpc\(\s*"verify_admin_login"/);
  assert.match(verification, /verificationResult\?\.\[0\]\?\.is_valid !== true/);
});

test("admin shell authorizes support admins only through the dedicated server grant endpoint", () => {
  assert.doesNotMatch(verification, /if \(adminEmail\)/);
  assert.doesNotMatch(verification, /check_is_admin/);
  assert.match(verification, /fetch\("\/api\/admin\/support-admins\/status"/);
  assert.match(verification, /supportStatus\?\.isSupportAdmin === true/);
  assert.match(verification, /setSupportMode\(supportStatus\.emergencyActive \? "emergency" : "readonly"\)/);
  assert.equal((verification.match(/setAuthStatus\("authorized"\)/g) || []).length, 2);
});

test("admin shell distinguishes verification errors and fails closed if neither admin verification nor support grant succeeds", () => {
  assert.match(source, /"verification-unavailable"/);
  assert.match(verification, /setAuthStatus\(rpcError \? "verification-unavailable" : "unauthorized"\)/);
  assert.match(source, /Admin Verification Unavailable/);
  assert.match(source, /Protected controls remain locked/);
});
