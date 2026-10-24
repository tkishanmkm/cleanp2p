/**
 * Strict decimal parser for user-supplied withdrawal amounts.
 * Rejects partial parses (for example, "1.2junk") and non-decimal notation.
 */
export function parseWithdrawalAmount(rawAmount: number | string): number {
  if (typeof rawAmount === 'number') {
    return Number.isFinite(rawAmount) ? rawAmount : Number.NaN;
  }

  const amountText = rawAmount.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(amountText)) {
    return Number.NaN;
  }

  const amount = Number(amountText);
  return Number.isFinite(amount) ? amount : Number.NaN;
}
