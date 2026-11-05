import 'server-only';

import { calculateMinimumFiatAmount } from '@/lib/currency';

const CACHE_TTL_MS = 5 * 60 * 1000;
let cachedRates: { values: Record<string, number>; expiresAt: number } | null = null;
let inFlightRates: Promise<Record<string, number> | null> | null = null;

function normalizeRateMap(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  const result: Record<string, number> = { USD: 1 };
  for (const [rawCode, rawRate] of Object.entries(input)) {
    const code = rawCode.trim().toUpperCase();
    const rate = typeof rawRate === 'number' ? rawRate : Number(rawRate);
    if (/^[A-Z]{3}$/.test(code) && Number.isFinite(rate) && rate > 0 && rate < 1e9) {
      result[code] = rate;
    }
  }
  return Object.keys(result).length > 1 ? result : null;
}

async function loadRates(): Promise<Record<string, number> | null> {
  if (cachedRates && cachedRates.expiresAt > Date.now()) return cachedRates.values;
  if (inFlightRates) return inFlightRates;

  inFlightRates = (async () => {
    let rates: Record<string, number> | null = null;

    try {
      const response = await fetch('https://open.er-api.com/v6/latest/USD', {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(3500),
      });
      if (response.ok) {
        const payload: unknown = await response.json();
        if (payload && typeof payload === 'object') {
          const record = payload as Record<string, unknown>;
          if (record.result === 'success' && String(record.base_code || '').toUpperCase() === 'USD') {
            rates = normalizeRateMap(record.rates);
          }
        }
      }
    } catch {
      // Retry against the secondary provider below.
    }

    if (!rates) {
      try {
        const response = await fetch('https://api.frankfurter.app/latest?from=USD', {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(3500),
        });
        if (response.ok) {
          const payload: unknown = await response.json();
          if (payload && typeof payload === 'object') {
            const record = payload as Record<string, unknown>;
            if (String(record.base || '').toUpperCase() === 'USD') {
              rates = normalizeRateMap(record.rates);
            }
          }
        }
      } catch {
        // No rate is returned when both trusted rate providers are unavailable.
      }
    }

    if (rates) cachedRates = { values: rates, expiresAt: Date.now() + CACHE_TTL_MS };
    return rates;
  })();

  try {
    return await inFlightRates;
  } finally {
    inFlightRates = null;
  }
}

/**
 * Returns the server-authoritative fiat minimum for a USD-denominated policy.
 * Null means no reliable USD conversion rate was available; callers must fail closed.
 */
export async function getMinimumFiatAmountFromUsd(
  usdMinimum: number,
  targetCurrency: string,
): Promise<number | null> {
  const currency = String(targetCurrency || '').trim().toUpperCase();
  if (!Number.isFinite(usdMinimum) || usdMinimum <= 0 || !/^[A-Z]{3}$/.test(currency)) {
    return null;
  }
  if (currency === 'USD') return calculateMinimumFiatAmount(usdMinimum, 'USD', { USD: 1 });

  const rates = await loadRates();
  const rate = rates?.[currency];
  if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0) return null;
  return calculateMinimumFiatAmount(usdMinimum, currency, rates ?? undefined);
}
