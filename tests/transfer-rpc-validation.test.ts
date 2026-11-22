import assert from "node:assert/strict";
import test from "node:test";
import { isValidTransferRpcResponse } from "../src/lib/transfer-rpc-validation";

const expected = {
  senderId: "sender-uuid",
  recipientId: "recipient-uuid",
  asset: "USDT",
  amount: 100,
  feeRate: 0.015,
};

const validResponse = {
  success: true,
  transfer_id: "transfer-uuid",
  public_id: "TRF123456789",
  sender_id: expected.senderId,
  recipient_id: expected.recipientId,
  asset: "USDT",
  gross_amount: 100,
  net_amount: 100,
  fee_amount: 1.5,
  total_deduction: 101.5,
  sender_balance_after: 898.5,
  recipient_balance_after: 100,
  status: "confirmed",
  idempotent_replay: false,
  legacy_fee_model: false,
};

test("accepts a well-formed successful RPC response matching the request", () => {
  assert.equal(isValidTransferRpcResponse(validResponse, expected), true);
});

test("accepts old fee semantics only for an exact idempotent replay", () => {
  const legacyReplay = {
    ...validResponse,
    net_amount: 98.5,
    total_deduction: 100,
    idempotent_replay: true,
    legacy_fee_model: true,
  };
  assert.equal(isValidTransferRpcResponse(legacyReplay, expected), true);
  assert.equal(isValidTransferRpcResponse({ ...legacyReplay, idempotent_replay: false }, expected), false);
  assert.equal(isValidTransferRpcResponse({ ...legacyReplay, total_deduction: 101.5 }, expected), false);
  assert.equal(isValidTransferRpcResponse({ ...legacyReplay, legacy_fee_model: "true" }, expected), false);
});

test("rejects mismatched participant, asset, or requested amount", () => {
  assert.equal(isValidTransferRpcResponse({ ...validResponse, sender_id: "attacker" }, expected), false);
  assert.equal(isValidTransferRpcResponse({ ...validResponse, recipient_id: "other-user" }, expected), false);
  assert.equal(isValidTransferRpcResponse({ ...validResponse, asset: "BTC" }, expected), false);
  assert.equal(isValidTransferRpcResponse({ ...validResponse, gross_amount: 99 }, expected), false);
});

test("rejects non-finite, negative, and internally inconsistent financial values", () => {
  assert.equal(isValidTransferRpcResponse({ ...validResponse, gross_amount: "NaN" }, expected), false);
  assert.equal(isValidTransferRpcResponse({ ...validResponse, fee_amount: -1 }, expected), false);
  assert.equal(isValidTransferRpcResponse({ ...validResponse, total_deduction: 100 }, expected), false);
  assert.equal(isValidTransferRpcResponse({ ...validResponse, sender_balance_after: "Infinity" }, expected), false);
  assert.equal(isValidTransferRpcResponse({ ...validResponse, net_amount: 0 }, expected), false);
});

test("rejects failed, missing, or malformed RPC payloads", () => {
  assert.equal(isValidTransferRpcResponse(null, expected), false);
  assert.equal(isValidTransferRpcResponse({ ...validResponse, success: false }, expected), false);
  assert.equal(isValidTransferRpcResponse({ ...validResponse, transfer_id: "" }, expected), false);
  assert.equal(isValidTransferRpcResponse({ ...validResponse, status: 123 }, expected), false);
});
