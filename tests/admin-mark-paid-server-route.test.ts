import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const route = readFileSync(
  join(process.cwd(), "src/app/api/admin/trades/[tradeId]/route.ts"),
  "utf8",
);
const helper = readFileSync(
  join(process.cwd(), "src/lib/admin.ts"),
  "utf8",
);
const actions = readFileSync(
  join(process.cwd(), "src/app/adminnarayan/users/actions.ts"),
  "utf8",
);

test("admin mark-paid route requires the verified full-admin path and rejects support admins", () => {
  const post = route.slice(route.indexOf("export async function POST"));
  assert.match(post, /const auth = await verifyServerAdmin\(req\)/);
  assert.match(post, /const adminId = auth\.adminId \|\| auth\.user\.id/);
  assert.match(post, /const adminEmail = auth\.adminEmail \|\| auth\.user\.email \|\| null/);
  assert.match(post, /\["join", "message", "intervene", "mark_paid"\]/);
  assert.match(post, /if \(action === "mark_paid" && auth\.supportAdmin === true\)/);
  assert.match(post, /reason\.trim\(\)\.length < 10/);
  assert.match(post, /supabase\.rpc\("admin_mark_trade_paid_authorized"/);
  assert.match(post, /p_actor_id: adminId/);
  assert.match(post, /p_actor_email: adminEmail/);
  assert.match(post, /rpcData\.audit_logged !== true/);
  assert.doesNotMatch(post, /body\.adminId|body\.adminEmail|body\.admin_id|body\.admin_email/i);
});

test("browser helper sends mark-paid to the protected server route instead of the privileged RPC", () => {
  const start = helper.indexOf("export async function adminMarkTradeAsPaid");
  assert.notEqual(start, -1);
  const end = helper.indexOf("export async function adminReleaseFunds", start);
  const fn = helper.slice(start, end);
  assert.match(fn, /\/api\/admin\/trades\//);
  assert.match(fn, /encodeURIComponent\(trade\.id\)/);
  assert.match(fn, /action: 'mark_paid'/);
  assert.match(fn, /reason/);
  assert.doesNotMatch(fn, /supabase\.rpc|mark_p2p_trade_paid/);
});

test("user management server actions preserve 2FA verification and support-admin restrictions", () => {
  for (const action of ["updateUserRoleAction", "toggleUserSuspensionAction", "toggleUserBanStatus", "freezeUserAction", "unfreezeUserAction"]) {
    const start = actions.indexOf("export async function " + action);
    assert.notEqual(start, -1);
    const next = actions.indexOf("export async function ", start + 1);
    const body = actions.slice(start, next < 0 ? undefined : next);
    assert.match(body, /verifyServerAdmin\(\)/);
    assert.match(body, /auth\.supportAdmin === true/);
  }
});

console.log("PASS: admin mark-paid browser flow is mediated by full-admin server authorization and the database audit wrapper.");
