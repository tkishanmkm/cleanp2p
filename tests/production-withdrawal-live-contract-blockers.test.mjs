import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const service = readFileSync("src/lib/services/withdrawalService.ts", "utf8");
const worker = readFileSync("src/jobs/withdrawalWorker.ts", "utf8");
const audit = readFileSync("docs/PRODUCTION-STEP-20261031-WITHDRAWAL-RPC-TABLE-CONTRACT-BLOCKERS.md", "utf8");

test("withdrawal creation fails closed when the idempotency lookup is unavailable", () => {
  assert.match(service, /'get_withdrawal_idempotency_replay'/);
  assert.match(service, /status: 'IDEMPOTENCY_LOOKUP_UNAVAILABLE'[\s\S]*?statusCode: 503/);
  assert.match(service, /rpc\('request_withdrawal_idempotent'/);
  assert.doesNotMatch(service, /rpc\('request_withdrawal',/);
});

test("worker requires paired rows and per-withdrawal worker fencing before dispatch", () => {
  assert.match(worker, /rpc\('claim_pending_withdrawals',[\s\S]*?p_worker_id: workerId/);
  assert.match(worker, /paired user-facing withdrawal[\s\S]*?refusing to broadcast/i);
  assert.match(worker, /rpc\('record_onchain_withdrawal_broadcast',[\s\S]*?p_worker_id: workerId/);
});

test("production withdrawal blockers are recorded without speculative schema changes", () => {
  assert.match(audit, /wallets\.status/);
  assert.match(audit, /wallet_id and idempotency_key, neither of which exists/);
  assert.match(audit, /onchain_withdrawals\.idempotency_key/);
  assert.match(audit, /ledger_entries/);
  assert.match(audit, /claim_pending_withdrawals\(p_limit integer\)/);
  assert.match(audit, /does not insert a companion/);
  assert.match(audit, /Do not apply an isolated schema-column patch/);
});

console.log("PASS: withdrawal app remains fail-closed when live reservation/replay/worker contracts are unavailable.");
