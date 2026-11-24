import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const file = "src/app/api/admin/disputes/resolve/route.ts";
const route = readFileSync(join(process.cwd(), file), "utf8");
const handler = route.slice(route.indexOf("export async function POST"));
const helper = readFileSync(join(process.cwd(), "src/lib/admin-dispute-settlement.ts"), "utf8");

assert.match(handler, /const auth = await verifyServerAdmin\(req\)/, "server admin verification is required");
assert.match(handler, /if \(auth\.supportAdmin === true\)/, "support-admin sessions are explicitly denied");
assert.ok(handler.indexOf("if (auth.supportAdmin === true)") < handler.indexOf("req.json"), "support denial happens before request-body processing");
assert.ok(handler.includes("resolveDisputeAtomically("), "the route uses the single atomic settlement service");
assert.doesNotMatch(handler, /rpc\(['"]release_trade_escrow['"]/);
assert.doesNotMatch(handler, /rpc\(['"]cancel_p2p_trade['"]/);
assert.match(helper, /PAXONES_ATOMIC_DISPUTE_SETTLEMENT_ENABLED !== 'true'/);
assert.match(helper, /DISPUTE_ATOMIC_SETTLEMENT_UNVERIFIED/);
assert.ok(helper.indexOf("PAXONES_ATOMIC_DISPUTE_SETTLEMENT_ENABLED !== 'true'") < helper.indexOf("getSupabaseAdminClient()"), "feature gate runs before database access");
assert.match(helper, /rpc\('admin_resolve_trade_dispute_atomic'/);
assert.match(helper, /data\.audit_logged !== true/);

console.log("PASS: dispute-resolution support-admin boundary and fail-closed atomic service contract");
console.log("NOTE: database migration remains gated and requires isolated PostgreSQL settlement/replay/race tests.");
