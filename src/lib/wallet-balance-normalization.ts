type WalletAssetBalanceRow = Record<string, unknown>;

function finiteNonNegative(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && value.trim() === '') return null;

  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : null;
}

function maxFrom(row: WalletAssetBalanceRow, fields: string[]): number {
  return fields.reduce((maximum, field) => {
    const value = finiteNonNegative(row[field]);
    return value === null ? maximum : Math.max(maximum, value);
  }, 0);
}

/**
 * wallet_assets.balance is the spendable amount in the deployed financial RPCs:
 * escrow and withdrawal requests decrement it while increasing their matching
 * liability columns. Never subtract those liabilities from balance a second time.
 */
export function normalizePrimaryWalletAssetBalance(
  row: WalletAssetBalanceRow,
  activeEscrowFallback: unknown = 0,
): { available: number; inEscrow: number; inWithdrawal: number; total: number } {
  const explicitAvailable = finiteNonNegative(row.available);
  const spendableBalance = finiteNonNegative(row.balance);
  const available = explicitAvailable ?? spendableBalance ?? 0;

  const inEscrow = Math.max(
    maxFrom(row, ['locked_balance', 'locked_escrow', 'locked', 'in_escrow', 'reserved_balance']),
    finiteNonNegative(activeEscrowFallback) ?? 0,
  );
  const inWithdrawal = maxFrom(row, ['locked_withdrawal', 'in_withdrawal']);

  return {
    available,
    inEscrow,
    inWithdrawal,
    total: available + inEscrow + inWithdrawal,
  };
}
