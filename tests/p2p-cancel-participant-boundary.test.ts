import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routes = [
  "src/app/api/p2p/trade/cancel/route.ts",
  "src/app/api/p2p/trades/[tradeId]/cancel/route.ts",
];

for (const file of routes) {
  const source = readFileSync(join(process.cwd(), file), "utf8");
  assert.ok(source.includes("supabase.auth.getUser()"), `${file}: must authenticate the caller`);
  assert.ok(source.includes("user.user_metadata?.role === 'admin'"), `${file}: must not let user-editable admin metadata widen user-route privileges`);
  assert.ok(source.includes(".select('id, buyer_id, seller_id')"), `${file}: must load the authoritative trade participants`);
  assert.ok(source.includes("trade.buyer_id !== user.id && trade.seller_id !== user.id"), `${file}: must reject non-participants`);
  assert.ok(source.includes("getSupabaseAdminClient()"), `${file}: must call the service-role-only canonical RPC through server credentials`);
  assert.ok(source.includes("rpc('cancel_p2p_trade'"), `${file}: must retain canonical atomic cancellation`);
}

console.log("PASS: both P2P cancellation routes enforce authenticated participant-only access before the canonical RPC");
console.log("NOTE: static contract test; runtime and database integration tests remain required.");
