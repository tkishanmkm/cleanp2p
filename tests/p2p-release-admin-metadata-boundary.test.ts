import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const routes = [
  { file: "src/app/api/p2p/trade/release/route.ts", marker: "const body = await request.json()" },
  { file: "src/app/api/p2p/trades/[tradeId]/release/route.ts", marker: "const adminClient = getSupabaseAdminClient()" },
  { file: "src/app/api/trades/[tradeId]/actions/route.ts", marker: "if (!trade.seller_id || trade.seller_id !== user.id)" },
];

for (const { file, marker } of routes) {
  const source = readFileSync(join(process.cwd(), file), "utf8");
  const releaseStart = file.includes("actions/route.ts") ? source.indexOf("if (action === 'RELEASE_ESCROW')") : 0;
  const relevant = source.slice(releaseStart);
  assert.ok(relevant.includes("user.user_metadata?.role === 'admin'"), `${file}: reject user-editable admin role metadata on participant release path`);
  assert.ok(relevant.includes("user.app_metadata?.role === 'admin'"), `${file}: route admin identity through the verified admin workflow`);
  assert.ok(relevant.indexOf("user.user_metadata?.role === 'admin'") < relevant.indexOf(marker), `${file}: check admin metadata before parsing/settlement-sensitive actions`);
}

console.log("PASS: participant escrow-release routes reject admin metadata claims before release handling");
console.log("NOTE: static contract test; controlled runtime and database tests remain required.");
