import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const file = "src/app/api/admin/disputes/[tradeId]/route.ts";
const source = readFileSync(join(process.cwd(), file), "utf8");
const post = source.slice(source.indexOf("export async function POST"));

assert.match(post, /verifyServerAdmin\(req\)/, "route must verify server-side admin authorization");
assert.match(post, /if \(auth\.supportAdmin === true\)/, "support-admin sessions must be explicitly denied");
assert.ok(post.includes("Support administrators cannot resolve disputes or settle escrow."), "denial message is present");
assert.ok(!post.includes("req.json"), "fail-closed route does not parse or process settlement payload");
assert.ok(post.includes("DISPUTE_ATOMIC_SETTLEMENT_UNVERIFIED"), "unverified settlement returns a stable fail-closed code");
assert.ok(!post.includes("rpc('release_trade_escrow'"), "no escrow release RPC is called");
assert.ok(!post.includes("rpc('cancel_p2p_trade'"), "no escrow cancellation RPC is called");

console.log("PASS: trade-ID dispute route support-admin boundary source contract");
console.log("NOTE: static test only; settlement still requires controlled database/runtime validation.");
