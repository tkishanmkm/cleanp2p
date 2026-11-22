import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const guard = read("src/lib/account-action-guard.ts");
assert.match(guard, /is_restricted/);
assert.match(guard, /is_banned/);
assert.match(guard, /is_suspended/);
assert.match(guard, /ACCOUNT_RESTRICTED/);
assert.match(guard, /Existing active trades can continue/);

for (const path of [
  "src/app/api/trades/create/route.ts",
  "src/app/api/trades/initiate/route.ts",
  "src/app/api/trades/route.ts",
  "src/app/api/p2p/trade/initiate/route.ts",
  "src/app/api/p2p/orders/create/route.ts",
]) {
  const source = read(path);
  assert.match(source, /checkNewTradeEligibility/);
  assert.match(source, /eligibility\.allowed/);
}

const adCreate = read("src/app/api/p2p/ads/route.ts");
assert.match(adCreate, /ACCOUNT_AD_ACCESS_BLOCKED/);
assert.match(adCreate, /is_restricted === true/);

const withdrawal = read("src/lib/services/withdrawalService.ts");
assert.match(withdrawal, /is_restricted, is_suspended/);
assert.match(withdrawal, /userProfile\.is_restricted === true/);
assert.match(withdrawal, /'BLOCKED'/);

const transfer = read("src/app/api/wallet/transfer/route.ts");
assert.match(transfer, /isTransferAccountBlocked\(senderProfile\)/);
assert.match(transfer, /isTransferAccountBlocked\(recipientProfile\)/);

const blockRoute = read("src/app/api/user/block/route.ts");
assert.match(blockRoute, /action === 'BLOCK'/);
assert.match(blockRoute, /blockerProfile\.is_restricted === true/);
assert.match(blockRoute, /Restricted accounts cannot block other users/);

console.log("PASS: restricted-account rules are enforced at trade, ad, withdrawal, transfer, and block API boundaries");
console.log("NOTE: static source-contract tests do not replace SQL/RPC and live integration tests.");
