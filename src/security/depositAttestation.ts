import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Version-1 deposit attestation canonicalization.
 * This helper is not a trust boundary by itself. The database credit function
 * must independently verify the MAC using a secret unavailable to service_role.
 */
export interface DepositAttestationV1 {
  version: "deposit-attestation-v1";
  nonce: string;
  network: string;
  txHash: string;
  outputIndex: string;
  blockNumber: string;
  blockHash: string;
  destination: string;
  userAddressId: string;
  asset: string;
  tokenContract: string;
  rawAmount: string;
  confirmations: string;
  verifierVersion: string;
  issuedAt: string;
  expiresAt: string;
}

const FIELD_ORDER: ReadonlyArray<keyof DepositAttestationV1> = [
  "version", "nonce", "network", "txHash", "outputIndex", "blockNumber",
  "blockHash", "destination", "userAddressId", "asset", "tokenContract",
  "rawAmount", "confirmations", "verifierVersion", "issuedAt", "expiresAt",
];
const SAFE_FIELD = /^[^\r\n\u0000]*$/;
const NON_NEGATIVE_INTEGER = /^(0|[1-9][0-9]*)$/;
const HEX_HASH = /^0x[0-9a-fA-F]{64}$/;
const TX_HASH = /^(0x[0-9a-fA-F]{64}|[0-9a-fA-F]{64}|[A-Za-z0-9:_-]{16,160})$/;
const ADDRESS_ID = /^[0-9a-fA-F-]{16,64}$/;
const NONCE = /^[A-Za-z0-9_-]{16,128}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function assertField(value: unknown, field: string): asserts value is string {
  if (typeof value !== "string" || !SAFE_FIELD.test(value) || value.length === 0) {
    throw new Error(`Invalid attestation field: ${field}`);
  }
}

export function canonicalizeDepositAttestationV1(payload: DepositAttestationV1): string {
  if (!payload || typeof payload !== "object") throw new Error("Invalid attestation payload");
  for (const field of FIELD_ORDER) assertField(payload[field], field);
  if (payload.version !== "deposit-attestation-v1") throw new Error("Unsupported attestation version");
  if (!NONCE.test(payload.nonce)) throw new Error("Invalid attestation nonce");
  if (!/^[A-Z0-9_-]{2,24}$/.test(payload.network)) throw new Error("Invalid network");
  if (!TX_HASH.test(payload.txHash)) throw new Error("Invalid transaction hash");
  if (!NON_NEGATIVE_INTEGER.test(payload.outputIndex)) throw new Error("Invalid output index");
  if (!NON_NEGATIVE_INTEGER.test(payload.blockNumber)) throw new Error("Invalid block number");
  if (payload.blockHash !== "native" && !HEX_HASH.test(payload.blockHash)) throw new Error("Invalid block hash");
  if (!ADDRESS_ID.test(payload.userAddressId)) throw new Error("Invalid address identity");
  if (!/^[A-Z0-9]{2,16}$/.test(payload.asset)) throw new Error("Invalid asset");
  if (payload.destination !== payload.destination.trim() || /\\s/.test(payload.destination)) throw new Error("Destination must be pre-normalized with no whitespace");
  if (payload.destination.length > 256) throw new Error("Destination is too long");
  if (payload.tokenContract !== "native" && (payload.tokenContract !== payload.tokenContract.trim() || /\\s/.test(payload.tokenContract) || payload.tokenContract.length > 256)) throw new Error("Invalid token contract");
  if (!NON_NEGATIVE_INTEGER.test(payload.rawAmount) || payload.rawAmount === "0") throw new Error("Invalid raw amount");
  if (!NON_NEGATIVE_INTEGER.test(payload.confirmations)) throw new Error("Invalid confirmations");
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(payload.verifierVersion)) throw new Error("Invalid verifier version");
  if (!ISO_UTC.test(payload.issuedAt) || !ISO_UTC.test(payload.expiresAt)) throw new Error("Invalid timestamp");
  const issuedAtMs = Date.parse(payload.issuedAt);
  const expiresAtMs = Date.parse(payload.expiresAt);
  if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs) ||
      new Date(issuedAtMs).toISOString() !== payload.issuedAt ||
      new Date(expiresAtMs).toISOString() !== payload.expiresAt) throw new Error("Invalid calendar timestamp");
  if (expiresAtMs <= issuedAtMs) throw new Error("Invalid attestation lifetime");
  return FIELD_ORDER.map((field) => payload[field]).join("\n");
}

export function createDepositAttestationMac(payload: DepositAttestationV1, secret: string): string {
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("Attestation secret must be at least 32 UTF-8 bytes");
  }
  return createHmac("sha256", secret)
    .update(canonicalizeDepositAttestationV1(payload), "utf8")
    .digest("hex");
}

export function verifyDepositAttestationMac(
  payload: DepositAttestationV1,
  suppliedMac: string,
  secret: string,
  nowMs = Date.now(),
): boolean {
  if (!/^[0-9a-f]{64}$/.test(suppliedMac)) return false;
  let expected: Buffer;
  try {
    const issuedAtMs = Date.parse(payload.issuedAt);
    const expiresAtMs = Date.parse(payload.expiresAt);
    if (!Number.isFinite(issuedAtMs) || !Number.isFinite(expiresAtMs)) return false;
    if (issuedAtMs > nowMs + 30_000) return false;
    if (expiresAtMs <= nowMs) return false;
    expected = Buffer.from(createDepositAttestationMac(payload, secret), "hex");
  } catch {
    return false;
  }
  const supplied = Buffer.from(suppliedMac, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}
