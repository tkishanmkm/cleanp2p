import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const route = readFileSync(
  join(process.cwd(), "src/app/api/admin/platform-controls/bulk/route.ts"),
  "utf8",
);

const actions = [
  "pause_all_ads",
  "resume_all_ads",
  "delete_all_ads",
  "ban_all_users",
  "unban_all_users",
  "restrict_all_users",
  "unrestrict_all_users",
];

for (const action of actions) {
  const start = route.indexOf(`case "${action}"`);
  assert.notEqual(start, -1, `missing action case: ${action}`);
  const nextCase = route.indexOf("\n      case ", start + 1);
  const defaultCase = route.indexOf("\n      default:", start + 1);
  const endCandidates = [nextCase, defaultCase].filter((value) => value !== -1);
  const end = endCandidates.length ? Math.min(...endCandidates) : route.length;
  const block = route.slice(start, end);
  assert.match(
    block,
    /status:\s*res\.success\s*\?\s*200\s*:\s*500/,
    `${action} must return a failure HTTP status when the operation fails`,
  );
  assert.match(
    block,
    /message:\s*res\.success\s*\?/,
    `${action} must not emit success wording when the operation fails`,
  );
}

console.log("PASS: all bulk admin actions map operation failure to HTTP 500 and failure wording.");
console.log("NOTE: static source-contract test; runtime behavior and partial database effects still require isolated integration testing.");
