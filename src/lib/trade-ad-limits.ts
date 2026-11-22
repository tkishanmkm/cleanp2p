type AdLimitFields = {
  min_limit?: unknown;
  min_amount?: unknown;
  max_limit?: unknown;
  max_amount?: unknown;
};

/**
 * Validates a calculated fiat amount against the advertisement's stored limits.
 * Returns a safe user-facing error when the configuration or amount is invalid.
 */
export function validateAdFiatLimits(ad: AdLimitFields, fiatAmount: number): string | null {
  if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) {
    return 'Trade amount is outside the supported numeric range.';
  }

  const hasValue = (value: unknown): boolean =>
    value !== null && value !== undefined && !(typeof value === 'string' && value.trim() === '');
  const rawMin = hasValue(ad.min_limit) ? ad.min_limit : ad.min_amount;
  const rawMax = hasValue(ad.max_limit) ? ad.max_limit : ad.max_amount;
  const hasMin = hasValue(rawMin);
  const hasMax = hasValue(rawMax);
  const min = hasMin ? Number(rawMin) : null;
  const max = hasMax ? Number(rawMax) : null;

  if (min !== null && (!Number.isFinite(min) || min < 0)) {
    return 'Advertisement minimum limit is invalid.';
  }
  if (max !== null && (!Number.isFinite(max) || max <= 0)) {
    return 'Advertisement maximum limit is invalid.';
  }
  if (min !== null && max !== null && min > max) {
    return 'Advertisement limits are misconfigured.';
  }
  if ((min !== null && fiatAmount < min) || (max !== null && fiatAmount > max)) {
    return 'Trade amount is outside this advertisement’s limits.';
  }
  return null;
}
