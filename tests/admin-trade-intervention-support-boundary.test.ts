import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const file = "src/app/api/admin/trades/[tradeId]/route.ts";
const source = readFileSync(join(process.cwd(), file), "utf8");
const post = source.slice(source.indexOf("export async function POST"));

assert.match(post, /const auth = await verifyServerAdmin\(req\)/, "POST route requires server-side admin authorization");
assert.match(post, /if \(action === "intervene" && auth\.supportAdmin === true\)/, "support-admin sessions are blocked from escrow intervention");
assert.ok(post.includes("Support administrators cannot intervene in escrow settlement."), "explicit denial message exists");
assert.ok(post.includes("DISPUTE_ATOMIC_SETTLEMENT_UNVERIFIED"), "all escrow interventions fail closed until atomic workflow is verified");
assert.ok(post.indexOf("DISPUTE_ATOMIC_SETTLEMENT_UNVERIFIED") < post.indexOf('supabase.rpc("release_trade_escrow"'), "fail-closed guard must precede any release RPC");
assert.ok(post.indexOf("DISPUTE_ATOMIC_SETTLEMENT_UNVERIFIED") < post.indexOf('supabase.rpc("cancel_p2p_trade"'), "fail-closed guard must precede any cancellation RPC");
assert.match(post, /if \(action === "message"/, "support chat message workflow remains available");

console.log("PASS: admin trade intervention support-admin boundary source contract");
console.log("NOTE: static test only; runtime authorization and settlement need controlled integration tests.");
