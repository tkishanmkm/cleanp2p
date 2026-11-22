import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const file = "src/app/api/admin/p2p/disputes/route.ts";
const source = readFileSync(join(process.cwd(), file), "utf8");
const post = source.slice(source.indexOf("export async function POST"));

assert.match(post, /verifyServerAdmin\(request\)/, "route must authenticate before responding");
assert.match(post, /if \(!auth\.authorized\)/, "unauthorized requests must be rejected");
assert.match(post, /status: 503/, "legacy settlement must fail closed with service unavailable");
assert.match(post, /atomic escrow accounting/, "response explains the accounting safety hold");
assert.doesNotMatch(post, /\.rpc\(['"](?:release_escrow_funds|refund_disputed_escrow)['"]/, "unsafe legacy settlement RPCs must not be called");
assert.doesNotMatch(post, /\.from\(['"]p2p_orders['"]\)\.update/, "route must not mutate order status independently");
assert.doesNotMatch(post, /\.from\(['"]wallet_balances['"]\)/, "route must not write wallet balances directly");

console.log("PASS: legacy P2P dispute settlement fail-closed contract");
console.log("NOTE: static test only; confirm UI handles HTTP 503 and validate replacement settlement on a schema-matched test database.");
