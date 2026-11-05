import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const orderCreate = readFileSync(new URL("../src/app/api/p2p/orders/create/route.ts", import.meta.url), "utf8");
const p2pInitiate = readFileSync(new URL("../src/app/api/p2p/trade/initiate/route.ts", import.meta.url), "utf8");
const tradeInitiate = readFileSync(new URL("../src/app/api/trades/initiate/route.ts", import.meta.url), "utf8");

test("P2P order creation uses stored ad price and currency, not client overrides", () => {
  assert.match(orderCreate, /const rawStoredPrice = ad\.fixed_rate \?\? ad\.price/);
  assert.doesNotMatch(orderCreate, /Number\(price \?\? ad\.fixed_rate/);
  assert.match(orderCreate, /const resolvedFiatCurrency = ad\.fiat_currency \|\| ad\.fiat \|\| 'USD'/);
  assert.doesNotMatch(orderCreate, /fiatCurrency \|\| ad\.fiat_currency/);
});

test("P2P trade initiation uses stored ad price and currency, and validates the requested payment method", () => {
  assert.match(p2pInitiate, /const rawStoredPrice = ad\.fixed_rate \?\? ad\.price/);
  assert.doesNotMatch(p2pInitiate, /Number\(customPrice \?\? ad\.fixed_rate/);
  assert.match(p2pInitiate, /validPaymentMethods\.find/);
  assert.match(p2pInitiate, /const resolvedFiatCurrency = ad\.fiat_currency \|\| ad\.fiat \|\| 'USD'/);
  assert.doesNotMatch(p2pInitiate, /customFiatCurrency \|\| ad\.fiat_currency/);
});

test("canonical trade initiate rejects missing ad payment methods instead of inventing a default", () => {
  assert.match(tradeInitiate, /const rawPrice = ad\.fixed_rate \?\? ad\.price/);
  assert.match(tradeInitiate, /if \(paymentMethods\.length === 0\)/);
  assert.match(tradeInitiate, /This advertisement has no valid payment method configured/);
  assert.doesNotMatch(tradeInitiate, /resolvedPaymentMethod = trimmedCustom \|\| 'Bank Transfer'/);
  assert.match(tradeInitiate, /const resolvedFiatCurrency = ad\.fiat_currency \|\| ad\.fiat \|\| 'USD'/);
});
