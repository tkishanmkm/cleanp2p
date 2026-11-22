export interface ExpectedEscrowTradeReceipt {
  callerId: string;
  adOwnerId: string;
  adType: string;
  cryptoAmount: number;
  fiatAmount: number;
}

export interface EscrowTradeReceiptValidation {
  valid: boolean;
  reason?: string;
  tradeId?: string;
  publicId?: string;
  buyerId?: string;
  sellerId?: string;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function expectedParticipants(adType: string, callerId: string, adOwnerId: string): {
  buyerId: string;
  sellerId: string;
} | null {
  const normalized = adType.trim().toUpperCase();
  const isBuyAd = normalized === "BUY" || normalized === "ONLINE_BUY" || normalized.includes("BUY");
  const isSellAd = normalized === "SELL" || normalized === "ONLINE_SELL" || normalized.includes("SELL");

  if (isBuyAd === isSellAd) return null;
  return isBuyAd
    ? { buyerId: adOwnerId, sellerId: callerId }
    : { buyerId: callerId, sellerId: adOwnerId };
}

/**
 * A successful escrow RPC response must prove the committed trade identity,
 * participants and exact input amounts. Never infer a missing ID or participant
 * from the request: an invalid/ambiguous receipt must be checked by trade history
 * before the caller retries with a new idempotency key.
 */
export function validateEscrowTradeReceipt(
  value: unknown,
  expected: ExpectedEscrowTradeReceipt,
): EscrowTradeReceiptValidation {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, reason: "MALFORMED_RESPONSE" };
  }

  const result = value as Record<string, unknown>;
  if (result.success !== true) return { valid: false, reason: "RPC_NOT_SUCCESSFUL" };

  const tradeId = typeof result.trade_id === "string" ? result.trade_id : result.id;
  if (!isUuid(tradeId)) return { valid: false, reason: "TRADE_ID_INVALID" };

  const publicId = typeof result.public_id === "string" ? result.public_id.trim() : "";
  if (!publicId) return { valid: false, reason: "PUBLIC_ID_MISSING" };

  const participants = expectedParticipants(expected.adType, expected.callerId, expected.adOwnerId);
  if (!participants) return { valid: false, reason: "AD_TYPE_INVALID" };

  const buyerId = typeof result.buyer_id === "string" ? result.buyer_id : "";
  const sellerId = typeof result.seller_id === "string" ? result.seller_id : "";
  if (buyerId !== participants.buyerId || sellerId !== participants.sellerId || buyerId === sellerId) {
    return { valid: false, reason: "PARTICIPANT_MISMATCH" };
  }

  const cryptoAmount = Number(result.crypto_amount);
  const fiatAmount = Number(result.fiat_amount);
  if (
    !Number.isFinite(expected.cryptoAmount) || expected.cryptoAmount <= 0 ||
    !Number.isFinite(expected.fiatAmount) || expected.fiatAmount <= 0 ||
    !Number.isFinite(cryptoAmount) || cryptoAmount <= 0 ||
    !Number.isFinite(fiatAmount) || fiatAmount <= 0 ||
    cryptoAmount !== expected.cryptoAmount ||
    fiatAmount !== expected.fiatAmount
  ) {
    return { valid: false, reason: "AMOUNT_MISMATCH" };
  }

  return { valid: true, tradeId, publicId, buyerId, sellerId };
}
