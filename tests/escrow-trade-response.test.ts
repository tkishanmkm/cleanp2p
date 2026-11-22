import assert from "node:assert/strict";
import test from "node:test";
import { validateEscrowTradeReceipt } from "../src/lib/escrow-trade-response";

const callerId = "11111111-1111-4111-8111-111111111111";
const adOwnerId = "22222222-2222-4222-8222-222222222222";
const tradeId = "33333333-3333-4333-8333-333333333333";
const expected = { callerId, adOwnerId, adType: "SELL", cryptoAmount: 0.125, fiatAmount: 125 };

function response(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    trade_id: tradeId,
    public_id: "P2P123456",
    buyer_id: callerId,
    seller_id: adOwnerId,
    crypto_amount: expected.cryptoAmount,
    fiat_amount: expected.fiatAmount,
    ...overrides,
  };
}

test("accepts only complete SELL and BUY receipts with correct participants", () => {
  assert.equal(validateEscrowTradeReceipt(response(), expected).valid, true);
  const buy = validateEscrowTradeReceipt(response({
    buyer_id: adOwnerId,
    seller_id: callerId,
  }), { ...expected, adType: "ONLINE_BUY" });
  assert.equal(buy.valid, true);
});

test("rejects non-success payloads and missing identifiers", () => {
  assert.equal(validateEscrowTradeReceipt(response({ success: false }), expected).reason, "RPC_NOT_SUCCESSFUL");
  assert.equal(validateEscrowTradeReceipt(response({ trade_id: null }), expected).reason, "TRADE_ID_INVALID");
  assert.equal(validateEscrowTradeReceipt(response({ public_id: "" }), expected).reason, "PUBLIC_ID_MISSING");
  assert.equal(validateEscrowTradeReceipt(null, expected).valid, false);
});

test("rejects participant and amount mismatches", () => {
  assert.equal(validateEscrowTradeReceipt(response({ buyer_id: adOwnerId }), expected).reason, "PARTICIPANT_MISMATCH");
  assert.equal(validateEscrowTradeReceipt(response({ seller_id: callerId }), expected).reason, "PARTICIPANT_MISMATCH");
  assert.equal(validateEscrowTradeReceipt(response({ crypto_amount: 0.124 }), expected).reason, "AMOUNT_MISMATCH");
  assert.equal(validateEscrowTradeReceipt(response({ fiat_amount: 126 }), expected).reason, "AMOUNT_MISMATCH");
  assert.equal(validateEscrowTradeReceipt(response(), { ...expected, adType: "UNKNOWN" }).reason, "AD_TYPE_INVALID");
});

console.log("PASS: all escrow RPC entry points can use a strict common trade receipt contract.");
