import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../src/app/api/admin/disputes/[tradeId]/route.ts", import.meta.url),
  "utf8",
);

test("admin dispute route authenticates before the fail-closed settlement response", () => {
  assert.match(source, /verifyServerAdmin\(req\)/);
  assert.match(source, /if \(!auth\.authorized\)/);
  assert.match(source, /DISPUTE_ATOMIC_SETTLEMENT_UNVERIFIED/);
  assert.match(source, /status: 503/);
});

test("support administrators cannot settle disputes", () => {
  assert.match(source, /auth\.supportAdmin === true/);
  assert.match(source, /status: 403/);
  assert.match(source, /Support administrators cannot resolve disputes or settle escrow/);
});

test("disabled endpoint cannot perform separate or non-atomic settlement writes", () => {
  assert.doesNotMatch(source, /\.rpc\s*\(/);
  assert.doesNotMatch(source, /\.from\s*\(/);
  assert.match(source, /atomic settlement and audit bookkeeping are verified/);
});

test("route returns a generic error instead of exposing internal details", () => {
  assert.match(source, /Unable to resolve dispute/);
  assert.doesNotMatch(source, /NextResponse\.json\(\{\s*error:\s*errorMsg/);
});
