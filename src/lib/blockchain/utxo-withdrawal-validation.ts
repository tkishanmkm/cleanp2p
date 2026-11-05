/** Strictly validate a Bitcoin/Litecoin withdrawal against indexed transaction data. */
export function decimalToBaseUnits(value: unknown, decimals: number): bigint | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const input = String(value).trim();
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 18 || !/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(input)) return null;
  const [whole, fraction = ''] = input.split('.');
  if (fraction.length > decimals) return null;
  return BigInt(whole) * (10n ** BigInt(decimals)) + BigInt((fraction + '0'.repeat(decimals)).slice(0, decimals) || '0');
}

export function hasRequiredConfirmations(blockHeight: unknown, tipHeight: unknown, required: number): boolean {
  return Number.isSafeInteger(blockHeight) && Number(blockHeight) > 0
    && Number.isSafeInteger(tipHeight) && Number(tipHeight) >= Number(blockHeight)
    && Number.isSafeInteger(required) && required > 0
    && Number(tipHeight) - Number(blockHeight) + 1 >= required;
}

export function bitcoinLikePayoutMatches(
  txData: unknown,
  expectedTxHash: string,
  destination: string,
  amount: unknown,
): boolean {
  if (!txData || typeof txData !== 'object' || !destination || !/^[a-fA-F0-9]{64}$/.test(expectedTxHash)) return false;
  const tx = txData as { txid?: unknown; vout?: unknown };
  if (typeof tx.txid !== 'string' || !/^[a-fA-F0-9]{64}$/.test(tx.txid) || tx.txid.toLowerCase() !== expectedTxHash.toLowerCase()) return false;
  if (!Array.isArray(tx.vout)) return false;
  const expectedAmount = decimalToBaseUnits(amount, 8);
  if (expectedAmount === null || expectedAmount <= 0n) return false;
  let paidAmount = 0n;
  for (const output of tx.vout) {
    if (!output || typeof output !== 'object') return false;
    const item = output as { scriptpubkey_address?: unknown; value?: unknown };
    if (item.scriptpubkey_address !== destination) continue;
    if (typeof item.value !== 'number' || !Number.isSafeInteger(item.value) || item.value < 0) return false;
    paidAmount += BigInt(item.value);
  }
  return paidAmount === expectedAmount;
}
