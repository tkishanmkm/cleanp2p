/**
 * 12-Character Alphanumeric ID Generator
 * Enforces standard 12-character alphanumeric string IDs for Ads (ad_id) and Trades (trade_id).
 */

const ALPHANUMERIC_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const UPPER_ALPHANUMERIC_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

export function generate12CharId(options?: { uppercaseOnly?: boolean; prefix?: string }): string {
  const chars = options?.uppercaseOnly ? UPPER_ALPHANUMERIC_CHARS : ALPHANUMERIC_CHARS;
  const targetLength = 12;
  const prefix = options?.prefix || '';
  const randomLength = Math.max(0, targetLength - prefix.length);

  let randomPart = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const bytes = new Uint8Array(randomLength);
    crypto.getRandomValues(bytes);
    for (let i = 0; i < randomLength; i++) {
      randomPart += chars[bytes[i] % chars.length];
    }
  } else {
    for (let i = 0; i < randomLength; i++) {
      randomPart += chars.charAt(Math.floor(Math.random() * chars.length));
    }
  }

  const result = `${prefix}${randomPart}`;
  return result.length === 12 ? result : result.substring(0, 12).padEnd(12, '0');
}

export function generateAdId(): string {
  return generate12CharId({ uppercaseOnly: true, prefix: 'AD' });
}

export function generateTradeId(): string {
  return generate12CharId({ uppercaseOnly: true, prefix: 'TR' });
}
