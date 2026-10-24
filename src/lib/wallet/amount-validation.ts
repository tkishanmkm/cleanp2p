/**
 * Strict parser for USDT withdrawal amounts.
 *
 * USDT uses six decimal places on the supported withdrawal networks. Do not
 * use parseFloat here: it accepts partial values such as "12oops".
 */
export function parseWithdrawalAmount(raw: unknown): number | null {
  if (typeof raw !== 'number' && typeof raw !== 'string') return null;

  const amountText = String(raw).trim();
  if (!/^(?:\d+(?:\.\d{0,6})?|\.\d{1,6})$/.test(amountText)) return null;

  const amount = Number(amountText);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}
