import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const route = readFileSync(
  join(process.cwd(), "src/app/api/p2p/trades/[tradeId]/pay/route.ts"),
  "utf8",
);

assert.match(route, /supabase\.auth\.getUser\(\)/);
assert.match(route, /\.select\('buyer_id'\)/);
assert.match(route, /if \(trade\.buyer_id !== user\.id\)/);
assert.match(route, /Only the buyer can mark this trade as paid/);
assert.match(route, /supabase\.rpc\('mark_p2p_trade_paid'/);
assert.match(route, /p_caller_id: user\.id/);

console.log("PASS: P2P payment endpoint requires the authenticated buyer before it calls the participant RPC.");
