import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = process.cwd();
const route = readFileSync(join(root, "src/app/api/admin/platform-controls/bulk/route.ts"), "utf8");
const authHelper = readFileSync(join(root, "src/lib/server-admin-auth.ts"), "utf8");

test("bulk platform-control route authenticates each request and derives audit identity from verified user", () => {
  assert.match(route, /verifyServerAdmin\(req\)/);
  assert.match(route, /if\s*\(!auth\.authorized\)\s*\{\s*return auth\.response!/);
  assert.match(route, /const adminId\s*=\s*auth\.adminId\s*\|\|\s*auth\.user\.id/);
  assert.match(route, /const adminEmail\s*=\s*auth\.adminEmail/);
  assert.doesNotMatch(route, /body\.adminId|body\.adminEmail|p_admin_id\s*:\s*body\./);
});

test("server admin verifier ignores user-editable metadata and enforces configured admin 2FA", () => {
  assert.match(authHelper, /user\.app_metadata\?\.role\s*===\s*["']admin["']/);
  assert.match(authHelper, /Never trusts request body parameters or client headers for identity/);
  assert.match(authHelper, /verifyAdmin2FASessionToken\(sessionCookie,\s*user\.id,\s*securityVersion\)/);
  assert.doesNotMatch(authHelper, /user\.user_metadata\?\.(role|is_admin)/);
});
