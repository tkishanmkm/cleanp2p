// lib/currency.ts

export interface ExchangeRates {
  [key: string]: number | undefined; // e.g. { INR: 87.5, EUR: 0.92, GBP: 0.78, AED: 3.67 }
}

// Platform default base minimum trade limit in USD set by admin ($10 USD equivalent minimum)
export const BASE_PLATFORM_USD_MINIMUM = 10.00;

/**
 * Calculates the dynamic minimum trade limit for any fiat currency using live exchange rates.
 * Formula: Minimum Fiat Amount = USD Minimum ($10.00) * Live USD-to-Fiat Exchange Rate
 *
 * Example:
 * Base USD = $10.00 USD
 * 1 USD = 87.5 INR -> INR Min = ₹875
 * 1 USD = 0.92 EUR -> EUR Min = €9.20
 * 1 USD = 0.78 GBP -> GBP Min = £7.80
 * 1 USD = 3.67 AED -> AED Min = 36.70 AED
 */
export function calculateMinimumFiatAmount(
  baseUsdMinimum: number = BASE_PLATFORM_USD_MINIMUM,
  targetCurrency: string,
  rates?: ExchangeRates
): number {
  const currencyUpper = (targetCurrency || 'USD').toUpperCase();
  if (currencyUpper === 'USD') {
    return baseUsdMinimum;
  }

  const rate = rates?.[currencyUpper];
  if (!rate || typeof rate !== 'number' || rate <= 0 || isNaN(rate)) {
    // If currency not found in live rates, fallback to base USD equivalent
    return baseUsdMinimum;
  }

  const calculatedMin = baseUsdMinimum * rate;

  // Currencies with naturally high nominal values (like JPY, INR, NGN, PKR) format as rounded integers
  if (calculatedMin >= 100) {
    return Math.round(calculatedMin);
  }

  // Otherwise format with 2 decimal precision
  return Number(calculatedMin.toFixed(2));
}

/**
 * Convenience helper to get formatted minimum amount with currency label
 */
export function getMinimumTradeDisplay(
  targetCurrency: string,
  rates?: ExchangeRates,
  baseUsdMinimum: number = BASE_PLATFORM_USD_MINIMUM
): string {
  const min = calculateMinimumFiatAmount(baseUsdMinimum, targetCurrency, rates);
  return `${min} ${targetCurrency.toUpperCase()}`;
}

