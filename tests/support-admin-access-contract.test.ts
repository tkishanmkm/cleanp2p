import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (relativePath: string) => readFileSync(join(process.cwd(), relativePath), "utf8");
const auth = read("src/lib/server-admin-auth.ts");
const activate = read("src/app/api/admin/support-admins/emergency/activate/route.ts");
const configure = read("src/app/api/admin/support-admins/route.ts");
const restrict = read("src/app/api/admin/support-admins/restrict-user/route.ts");
const shell = read("src/app/adminnarayan/admin-shell.tsx");
const dashboardLayout = read("src/app/adminnarayan/dashboard/layout.tsx");
const supportTradeRoute = read("src/app/api/admin/trades/[tradeId]/route.ts");

assert.match(auth, /allowSupportReadOnly\?: boolean/);
assert.match(auth, /from\("support_admin_grants"\)/);
assert.match(auth, /from\("support_admin_emergency_sessions"\)/);
assert.match(auth, /if \(isSupportAdmin && supportEmergencySession/);
assert.match(auth, /verifyAdmin2FASessionToken\(sessionCookie, user\.id, securityVersion\)/);
assert.match(auth, /from\("support_admin_activity"\)/);
assert.match(auth, /Emergency action logging is unavailable; the request was blocked/);

assert.match(activate, /verifyAdminTOTPToken\(encryptedSecret, code\)/);
assert.match(activate, /adminDb\.rpc\(\s*['"]activate_support_admin_emergency['"]/);
assert.match(activate, /setAdmin2FACookie\(response, sessionToken\)/);
assert.match(activate, /emergency-mode eligibility could not be verified/i);

assert.match(configure, /auth\.supportAdmin/);
assert.match(configure, /configure_support_admin/);
assert.match(configure, /addEmergencyUses/);
assert.match(restrict, /auth\.supportAdmin !== true \|\| auth\.supportReadOnly !== true/);
assert.match(restrict, /REQUEST_USER_RESTRICTION_REVIEW/);
assert.match(restrict, /requires_full_admin_approval: true/);
assert.match(restrict, /account_changed: false/);
assert.doesNotMatch(restrict, /\.from\(["']profiles["']\)\s*\.update/);
assert.doesNotMatch(restrict, /\.from\(["']ads["']\)\s*\.update/);

assert.match(shell, /Support Admin .*View-only mode/);
assert.match(shell, /Request Restriction Review/);
assert.match(shell, /Restriction review request logged for full-administrator review/);
assert.match(shell, /handleEmergencyActivation/);
assert.match(shell, /support-admins\/emergency\/activate/);
assert.match(shell, /navItems\.filter\(\(item\) => supportMode === "none"/);
assert.match(dashboardLayout, /support_admin_grants/);
assert.match(supportTradeRoute, /supportVisibleMessages[\s\S]*moderator_only/);
assert.match(supportTradeRoute, /supportSafeDispute/);
assert.match(supportTradeRoute, /supportSafeProfile/);

for (const relativePath of [
  "src/app/api/admin/alerts/route.ts",
  "src/app/api/admin/audit-logs/route.ts",
  "src/app/api/admin/dashboard/overview/route.ts",
  "src/app/api/admin/metrics/route.ts",
  "src/app/api/admin/platform-settings/route.ts",
  "src/app/api/admin/search/route.ts",
  "src/app/api/admin/trades/[tradeId]/route.ts",
  "src/app/api/admin/user-blocks/route.ts",
  "src/app/api/admin/users/route.ts",
  "src/app/api/admin/users/[userId]/route.ts",
  "src/app/api/admin/wallets/route.ts",
]) {
  const source = read(relativePath);
  assert.match(source, /verifyServerAdmin\(req/, `missing canonical server admin authorization in ${relativePath}`);
}

// Emergency support sessions are scoped centrally to the trade-case routes;
// global admin/user/wallet routes are intentionally absent from this allow-list.
const supportScope = auth.slice(auth.indexOf('const allowedRead'), auth.indexOf('if (!allowedRead && !allowedWrite)'));
assert.match(supportScope, /isTradeIdPath/);
assert.match(supportScope, /isTradeMessagesPath/);
assert.match(supportScope, /isTradeSystemMessagePath/);
assert.match(supportScope, /isSupportStatusPath/);
assert.doesNotMatch(supportScope, /users|wallets|metrics|audit-logs|platform-settings/);

assert.match(read("src/app/api/admin/users/[userId]/route.ts"), /export async function POST[\s\S]*?verifyServerAdmin\(req\)/);
console.log("PASS: support-admin access, emergency activation, and restriction-route static contracts");
console.log("NOTE: these are source-contract tests; SQL must still be validated on a schema-matched disposable database.");
