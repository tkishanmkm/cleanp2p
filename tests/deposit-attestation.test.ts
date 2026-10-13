import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  createDepositAttestationMac,
  verifyDepositAttestationMac,
  type DepositAttestationV1,
} from "../src/security/depositAttestation";

const secret = "test-only-secret-for-deposit-attestation-v1";
const now = Date.parse("2026-10-14T00:00:00.000Z");
const payload: DepositAttestationV1 = {
  version: "deposit-attestation-v1",
  nonce: "nonce_1234567890abcdef",
  network: "BEP20",
  txHash: "0x" + "a".repeat(64),
  outputIndex: "2",
  blockNumber: "123456",
  blockHash: "0x" + "b".repeat(64),
  destination: "0x1111111111111111111111111111111111111111",
  userAddressId: "12345678-1234-1234-1234-123456789abc",
  asset: "USDT",
  tokenContract: "0x2222222222222222222222222222222222222222",
  rawAmount: "1234500",
  confirmations: "20",
  verifierVersion: "evm-verifier-1",
  issuedAt: "2026-10-14T00:00:00.000Z",
  expiresAt: "2026-10-14T00:05:00.000Z",
};

test("valid HMAC is accepted before expiry", () => {
  const mac = createDepositAttestationMac(payload, secret);
  assert.equal(verifyDepositAttestationMac(payload, mac, secret, now), true);
});
test("modified amount cannot reuse the original HMAC", () => {
  const mac = createDepositAttestationMac(payload, secret);
  assert.equal(verifyDepositAttestationMac({ ...payload, rawAmount: "9999999" }, mac, secret, now), false);
});
test("wrong secret is rejected", () => {
  const mac = createDepositAttestationMac(payload, secret);
  assert.equal(verifyDepositAttestationMac(payload, mac, "different-test-secret-that-is-long-enough", now), false);
});
test("expired attestations are rejected", () => {
  const mac = createDepositAttestationMac(payload, secret);
  assert.equal(verifyDepositAttestationMac(payload, mac, secret, Date.parse(payload.expiresAt)), false);
});
test("future-issued attestations beyond clock skew are rejected", () => {
  const future = { ...payload, issuedAt: "2026-10-14T00:10:00.000Z", expiresAt: "2026-10-14T00:15:00.000Z" };
  const mac = createDepositAttestationMac(future, secret);
  assert.equal(verifyDepositAttestationMac(future, mac, secret, now), false);
});
test("ambiguous newline fields and invalid raw amounts are rejected", () => {
  assert.throws(() => createDepositAttestationMac({ ...payload, destination: "x\ny" }, secret));
  assert.throws(() => createDepositAttestationMac({ ...payload, rawAmount: "1.25" }, secret));
});
test("short secrets and malformed MACs are rejected", () => {
  assert.throws(() => createDepositAttestationMac(payload, "too-short"));
  assert.equal(verifyDepositAttestationMac(payload, "not-a-mac", secret, now), false);
});

test("invalid calendar dates are rejected even when the timestamp shape looks valid", () => {
  assert.throws(() => createDepositAttestationMac({ ...payload, expiresAt: "2026-99-99T00:05:00.000Z" }, secret));
});
test("destinations with whitespace are rejected before signing", () => {
  assert.throws(() => createDepositAttestationMac({ ...payload, destination: " 0x1111111111111111111111111111111111111111" }, secret));
});
