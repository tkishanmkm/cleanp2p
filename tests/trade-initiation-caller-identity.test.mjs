import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const routes = [
  "../src/app/api/trades/route.ts",
  "../src/app/api/trades/create/route.ts",
  "../src/app/api/trades/initiate/route.ts",
  "../src/app/api/p2p/orders/create/route.ts",
  "../src/app/api/p2p/trade/initiate/route.ts",
];

test("every active trade initiation route passes the authenticated caller to the escrow RPC", () => {
  for (const route of routes) {
    const source = readFileSync(new URL(route, import.meta.url), "utf8");
    assert.match(source, /rpc\(['"]initiate_trade_with_escrow['"]/);
    assert.match(source, /p_caller_id:\s*user\.id/, `${route} must pass the authenticated user id`);
  }
});
