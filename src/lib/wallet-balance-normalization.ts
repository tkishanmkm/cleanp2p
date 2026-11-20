type WalletAssetBalanceRow = Record<string, unknown>;

function finiteNonNegative(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;

  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export interface NormalizedWalletAssetBalance {
  available: number;
  reserved: number;
  inEscrow: number;
  inWithdrawal: number;
  total: number;
  accountingValid: boolean;
}

/**
 * wallet_assets.balance is already the spendable balance. The deployed RPCs
 * move amounts from balance into reserved_balance, in_escrow and in_withdrawal.
 * locked_balance mirrors reserved_balance and is never an additional bucket.
 */
export function normalizePrimaryWalletAssetBalance(
  row: WalletAssetBalanceRow,
): NormalizedWalletAssetBalance {
  // The live schema permits NULL in legacy numeric buckets and its canonical
  // aggregate uses COALESCE(bucket, 0). Mirror that exact accounting contract.
  const available = finiteNonNegative(row.balance ?? 0);
  const reserved = finiteNonNegative(row.reserved_balance ?? 0);
  const lockedMirror = finiteNonNegative(row.locked_balance ?? 0);
  const inEscrow = finiteNonNegative(row.in_escrow ?? 0);
  const inWithdrawal = finiteNonNegative(row.in_withdrawal ?? 0);

  const valuesPresent =
    available !== null &&
    reserved !== null &&
    lockedMirror !== null &&
    inEscrow !== null &&
    inWithdrawal !== null;

  const mirrorMatches =
    lockedMirror !== null &&
    reserved !== null &&
    lockedMirror === reserved;

  const safeAvailable = available ?? 0;
  const safeReserved = reserved ?? 0;
  const safeEscrow = inEscrow ?? 0;
  const safeWithdrawal = inWithdrawal ?? 0;

  return {
    available: safeAvailable,
    reserved: safeReserved,
    inEscrow: safeEscrow,
    inWithdrawal: safeWithdrawal,
    total: safeAvailable + safeReserved + safeEscrow + safeWithdrawal,
    accountingValid: valuesPresent && mirrorMatches,
  };
}
