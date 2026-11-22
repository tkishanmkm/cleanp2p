import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const cases = [
  ["src/app/api/admin/withdrawals/approve/route.ts", "Support administrators cannot approve withdrawals."],
  ["src/app/api/admin/withdrawals/review/route.ts", "Support administrators cannot review or refund withdrawals."],
  ["src/app/api/admin/merchant/route.ts", "Support administrators cannot change merchant approval or tier."],
  ["src/app/api/admin/platform-controls/bulk/route.ts", "Support administrators cannot run bulk platform controls."],
];

for (const [file, message] of cases) {
  const source = readFileSync(join(process.cwd(), file), "utf8");
  const handler = source.slice(source.indexOf("export async function POST"));
  assert.match(handler, /const auth = await verifyServerAdmin\(req\)/, file + ": admin auth check exists");
  assert.match(handler, /if \(auth\.supportAdmin === true\)/, file + ": support-admin denied explicitly");
  assert.ok(handler.includes(message), file + ": denial response is present");
  assert.ok(handler.indexOf("if (auth.supportAdmin === true)") < handler.indexOf("req.json"), file + ": denial happens before body processing");
  console.log("PASS: " + file);
}

console.log("NOTE: static source-contract tests only; verify full-admin and support-admin behavior in a controlled runtime before release.");
