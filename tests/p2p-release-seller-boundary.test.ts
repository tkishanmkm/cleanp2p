import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routes = [
  "src/app/api/p2p/trade/release/route.ts",
  "src/app/api/p2p/trades/[tradeId]/release/route.ts",
];

for (const file of routes) {
  const source = readFileSync(join(process.cwd(), file), "utf8");
  assert.ok(source.includes("supabase.auth.getUser()"), `${file}: authenticate caller`);
  assert.ok(source.includes(".select('id, buyer_id, seller_id')"), `${file}: load authoritative trade ownership`);
  assert.ok(source.includes("trade.seller_id !== user.id"), `${file}: reject non-seller caller`);
  assert.ok(source.includes("getSupabaseAdminClient()"), `${file}: use server-side service client for canonical RPC`);
  assert.ok(source.includes("rpc('release_trade_escrow'"), `${file}: retain canonical escrow settlement RPC`);
  assert.ok(source.indexOf("trade.seller_id !== user.id") < source.indexOf("rpc('release_trade_escrow'"), `${file}: verify seller before settlement`);
}

console.log("PASS: both P2P escrow-release routes enforce seller-only access before canonical settlement");
console.log("NOTE: static contract test; runtime and database integration tests remain required.");
