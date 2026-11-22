import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const authSource = readFileSync(
  join(process.cwd(), "src/lib/server-admin-auth.ts"),
  "utf8",
);
const actions = readFileSync(
  join(process.cwd(), "src/app/adminnarayan/users/actions.ts"),
  "utf8",
);

assert.match(authSource, /import \{ cookies \} from "next\/headers"/);
const twoFactorGate = authSource.split("// 3. Admin 2FA Enforcement Gate")[1] ?? "";
assert.match(twoFactorGate, /if \(req\)\s*\{[\s\S]*?req\.cookies\.get\(ADMIN_2FA_COOKIE_NAME\)/);
assert.match(twoFactorGate, /else\s*\{[\s\S]*?const cookieStore = await cookies\(\)/);
assert.match(twoFactorGate, /cookieStore\.get\(ADMIN_2FA_COOKIE_NAME\)\?\.value/);
assert.match(twoFactorGate, /verifyAdmin2FASessionToken\(sessionCookie, user\.id, securityVersion\)/);
assert.doesNotMatch(twoFactorGate, /if \(!req\)\s*\{\s*return\s*\{\s*authorized:\s*true/);

for (const action of [
  "updateUserRoleAction",
  "toggleUserSuspensionAction",
  "toggleUserBanStatus",
  "freezeUserAction",
  "unfreezeUserAction",
]) {
  const start = actions.indexOf("export async function " + action);
  assert.notEqual(start, -1, "Missing server action: " + action);
  const next = actions.indexOf("export async function ", start + 1);
  const body = actions.slice(start, next < 0 ? undefined : next);
  assert.match(body, /verifyServerAdmin\(\)/, action + " verifies administrator session");
  assert.match(body, /auth\.supportAdmin === true/, action + " rejects support-admin sessions");
}

console.log("PASS: Server Actions read the request-scoped signed admin 2FA cookie, validate it, and account-control actions reject support-admin sessions.");
