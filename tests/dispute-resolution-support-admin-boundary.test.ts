import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const file = "src/app/api/admin/disputes/resolve/route.ts";
const source = readFileSync(join(process.cwd(), file), "utf8");
const handler = source.slice(source.indexOf("export async function POST"));

assert.match(handler, /const auth = await verifyServerAdmin\(req\)/, "server admin verification is required");
assert.match(handler, /if \(auth\.supportAdmin === true\)/, "support-admin sessions are explicitly denied");
assert.ok(handler.includes("Support administrators cannot resolve disputes or settle escrow."), "clear denial message is present");
assert.ok(!handler.includes("req.json"), "fail-closed route does not parse or process a settlement request");
assert.ok(handler.includes("DISPUTE_ATOMIC_SETTLEMENT_UNVERIFIED"), "unverified settlement returns a stable fail-closed code");
assert.ok(!handler.includes("rpc('release_trade_escrow'"), "no direct escrow release RPC is called");
assert.ok(!handler.includes("rpc('cancel_p2p_trade'"), "no direct escrow cancellation RPC is called");

console.log("PASS: dispute-resolution support-admin boundary source contract");
console.log("NOTE: static test only; runtime authorization must still be tested in a controlled environment.");
