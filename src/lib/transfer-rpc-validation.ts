export interface TransferRpcExpectedValues {
  senderId: string;
  recipientId: string;
  asset: string;
  amount: number;
}

interface TransferRpcResponseShape {
  success?: unknown;
  transfer_id?: unknown;
  public_id?: unknown;
  sender_id?: unknown;
  recipient_id?: unknown;
  asset?: unknown;
  gross_amount?: unknown;
  net_amount?: unknown;
  fee_amount?: unknown;
  fee_rate?: unknown;
  fee?: unknown;
  total_deduction?: unknown;
  sender_balance_after?: unknown;
  recipient_balance_after?: unknown;
  status?: unknown;
  idempotent_replay?: unknown;
  legacy_fee_model?: unknown;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Validates the trusted transfer RPC's result before the API reports success.
 * This is a response-integrity guard; the database RPC remains authoritative for
 * atomic balance mutations and ledger writes.
 */
export function isValidTransferRpcResponse(
  value: unknown,
  expected: TransferRpcExpectedValues,
): value is TransferRpcResponseShape & {
  success: true;
  transfer_id: string;
  sender_id: string;
  recipient_id: string;
  asset: string;
  gross_amount: number | string;
  net_amount: number | string;
  fee_amount: number | string;
  fee_rate?: number | string | null;
  total_deduction: number | string;
} {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const result = value as TransferRpcResponseShape;
  if (result.success !== true) return false;
  if (typeof result.transfer_id !== "string" || result.transfer_id.trim() === "") return false;
  if (result.sender_id !== expected.senderId || result.recipient_id !== expected.recipientId) return false;
  if (typeof result.asset !== "string" || result.asset.trim().toUpperCase() !== expected.asset.trim().toUpperCase()) return false;

  const gross = finiteNumber(result.gross_amount);
  const net = finiteNumber(result.net_amount);
  const fee = finiteNumber(result.fee_amount);
  const total = finiteNumber(result.total_deduction);
  if (gross === null || net === null || fee === null || total === null) return false;
  if (gross <= 0 || net <= 0 || fee < 0 || total <= 0) return false;

  if (!Number.isFinite(expected.amount) || expected.amount <= 0) return false;
  const amountTolerance = Math.max(1e-12, Math.abs(expected.amount) * 1e-12);
  if (Math.abs(gross - expected.amount) > amountTolerance) return false;

  const feeTolerance = 1e-8;
  if (result.legacy_fee_model !== undefined && typeof result.legacy_fee_model !== "boolean") return false;

  if (result.legacy_fee_model === true) {
    // Historical records used the entered amount as the total debit and reduced
    // the amount received by the fee. Accept this shape only for an idempotent
    // replay of an already-committed transfer; never for a new operation.
    if (result.idempotent_replay !== true) return false;
    if (Math.abs(total - gross) > feeTolerance) return false;
    if (Math.abs(net + fee - total) > feeTolerance) return false;
  } else {
    // Current contract: the recipient receives the entered amount and the sender
    // pays the fee captured by the database transaction, rounded to 8 decimals.
    // New transfers must return that exact rate. Replays may reference historical
    // transfers created before the rate snapshot was stored; those are checked by
    // their immutable amount/fee arithmetic instead of today's mutable setting.
    const replay = result.idempotent_replay === true;
    const appliedFeeRate = result.fee_rate == null ? null : finiteNumber(result.fee_rate);
    if (result.fee_rate != null && appliedFeeRate === null) return false;
    if (!replay && appliedFeeRate === null) return false;
    if (appliedFeeRate !== null) {
      if (appliedFeeRate < 0 || appliedFeeRate > 0.1) return false;
      const expectedFee = Math.round((gross * appliedFeeRate + Number.EPSILON) * 1e8) / 1e8;
      if (Math.abs(fee - expectedFee) > feeTolerance) return false;
    }
    if (Math.abs(net - gross) > amountTolerance) return false;
    if (Math.abs(total - (gross + fee)) > feeTolerance) return false;
  }

  for (const balance of [result.sender_balance_after, result.recipient_balance_after]) {
    if (balance !== undefined && balance !== null) {
      const parsedBalance = finiteNumber(balance);
      if (parsedBalance === null || parsedBalance < 0) return false;
    }
  }

  if (result.idempotent_replay !== undefined && typeof result.idempotent_replay !== "boolean") return false;
  if (typeof result.status !== "string" || result.status.trim() === "") return false;
  return true;
}
