// lib/currency.ts

export interface ExchangeRates {
  [key: string]: number; // e.g. { INR: 100, EUR: 0.90, GBP: 0.75, AED: 3.67 }
}

// Default fallback exchange rates against USD if live rates are momentarily unavailable
export const DEFAULT_EXCHANGE_RATES: ExchangeRates = {
  USD: 1,
  INR: 86.5,
  EUR: 0.92,
  GBP: 0.78,
  AED: 3.67,
  CAD: 1.38,
  AUD: 1.54,
  JPY: 153.2,
  SGD: 1.35,
  CNY: 7.24,
  THB: 35.8,
  BRL: 5.65,
  TRY: 34.2,
  NGN: 1580,
  PHP: 58.2,
  PKR: 278.5,
};

// Platform default base minimum trade limit in USD set by admin
export const BASE_PLATFORM_USD_MINIMUM = 5.00;

/**
 * Calculates the dynamic minimum trade limit for any fiat currency.
 * Formula: Minimum Fiat Amount = USD Minimum * Current USD-to-Fiat Exchange Rate
 *
 * Example:
 * Base USD = $5 USD
 * 1 USD = 100 INR -> INR Min = ₹500
 * 1 USD = 0.90 EUR -> EUR Min = €4.50
 * 1 USD = 0.75 GBP -> GBP Min = £3.75
 * 1 USD = 3.67 AED -> AED Min = 18.35 AED
 */
export function calculateMinimumFiatAmount(
  baseUsdMinimum: number = BASE_PLATFORM_USD_MINIMUM,
  targetCurrency: string,
  rates: ExchangeRates = DEFAULT_EXCHANGE_RATES
): number {
  const currencyUpper = (targetCurrency || 'USD').toUpperCase();
  if (currencyUpper === 'USD') {
    return baseUsdMinimum;
  }

  const rate = rates[currencyUpper] ?? DEFAULT_EXCHANGE_RATES[currencyUpper];
  if (!rate || rate <= 0) {
    // If currency not found in live or fallback rates, fallback to 1:1
    console.warn(`Missing exchange rate for fiat currency: ${targetCurrency}, defaulting to base`);
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
  rates: ExchangeRates = DEFAULT_EXCHANGE_RATES,
  baseUsdMinimum: number = BASE_PLATFORM_USD_MINIMUM
): string {
  const min = calculateMinimumFiatAmount(baseUsdMinimum, targetCurrency, rates);
  return `${min} ${targetCurrency.toUpperCase()}`;
}
