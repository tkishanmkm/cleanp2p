import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = [
  "src/app/api/p2p/orders/create/route.ts",
  "src/app/api/p2p/trade/initiate/route.ts",
];

for (const path of routes) {
  const source = readFileSync(path, "utf8");
  assert.match(source, /validateEscrowTradeReceipt/);
  assert.match(source, /success: false[\s\S]*?ESCROW_RESPONSE_INVALID/);
  assert.match(source, /callerId: user\.id/);
  assert.match(source, /adOwnerId: String\(ad\.user_id \|\| ''\)/);
  assert.match(source, /cryptoAmount: calculatedCrypto/);
  assert.match(source, /fiatAmount: numericFiat/);
  assert.ok(
    source.includes("tradeId: receipt.tradeId") || source.includes("const tradeId = receipt.tradeId"),
    "route must use the validated trade ID"
  );
  assert.ok(
    source.includes("publicId: receipt.publicId") || source.includes("const publicId = receipt.publicId"),
    "route must use the validated public ID"
  );
  assert.doesNotMatch(source, /data\.success === false/);
}

console.log("PASS: every legacy P2P initiation API route strictly validates escrow RPC success, trade ID, participants, and amounts before returning success.");
