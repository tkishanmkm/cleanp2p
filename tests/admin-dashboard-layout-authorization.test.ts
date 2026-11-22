import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "src/app/adminnarayan/dashboard/layout.tsx"),
  "utf8"
);

test("dashboard layout requires a verified authenticated user", () => {
  assert.match(source, /supabase\.auth\.getUser\(\)/);
  assert.match(source, /verify_admin_login/);
  assert.match(source, /verificationResult\?\.\[0\]\?\.is_valid !== true/);
  assert.match(source, /verification_unavailable/);
});

test("dashboard layout has no alternate admin-authorization fallback", () => {
  assert.doesNotMatch(source, /check_is_admin/);
  assert.doesNotMatch(source, /profile\.role\?\.toLowerCase\(\) === "admin"/);
});

test("dashboard layout blocks banned, suspended, held, and deleted accounts", () => {
  assert.match(source, /profile\.is_banned === true/);
  assert.match(source, /profile\.is_suspended === true/);
  assert.match(source, /status === "on_hold"/);
  assert.match(source, /accountStatus === "DELETION_PENDING"/);
  assert.match(source, /account_restricted/);
});

test("dashboard layout fails closed if profile status cannot be loaded", () => {
  assert.match(source, /account_status_unavailable/);
  assert.match(source, /if \(result\.error \|\| !result\.data\)/);
});

test("dashboard layout keeps redirects outside exception handlers", () => {
  assert.match(source, /Keep Next\.js redirect\(\) outside try\/catch blocks/);
  assert.doesNotMatch(source, /catch\s*\{\s*redirect\(/);
});
