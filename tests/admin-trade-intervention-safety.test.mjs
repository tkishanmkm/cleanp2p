import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/app/api/admin/trades/[tradeId]/route.ts", import.meta.url),
  "utf8",
);

test("admin trade intervention authenticates and fails closed before database settlement work", () => {
  const postStart = source.indexOf("export async function POST(");
  assert.notEqual(postStart, -1);
  const post = source.slice(postStart);
  const auth = post.indexOf("verifyServerAdmin(req)");
  const allowedActions = post.indexOf('["join", "message", "intervene", "mark_paid"].includes(action)');
  const interventionGuard = post.indexOf('if (action === "intervene")');
  const supabaseClient = post.indexOf("getSupabaseAdminClient()");
  assert.ok(auth >= 0 && allowedActions > auth && interventionGuard > allowedActions);
  assert.ok(supabaseClient > interventionGuard, "intervention must fail closed before DB client/settlement work");
  const guardBlock = post.slice(interventionGuard, supabaseClient);
  assert.match(guardBlock, /DISPUTE_ATOMIC_SETTLEMENT_UNVERIFIED/);
  assert.match(guardBlock, /status: 503/);
  assert.doesNotMatch(guardBlock, /\.rpc\(/);
});

test("admin settlement route retains canonical-state verification for non-settlement actions", () => {
  assert.match(source, /canonical settlement RPC owns the trade-state transition atomically/i);
  assert.match(source, /select\(["']id, status, escrow_status, is_disputed["']\)/);
  assert.match(source, /trade_state_verification/);
});
