'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback, useRef } from 'react';
import type { CryptoCurrency } from '@/lib/types';

interface PriceContextType {
  prices: Record<CryptoCurrency, number>;
  fiatRates: Record<string, number>;
  isLoading: boolean;
  loadingPrice: boolean;
  refreshPrices: () => Promise<void>;
}

const PriceContext = createContext<PriceContextType | undefined>(undefined);

const FALLBACK_PRICES: Record<CryptoCurrency, number> = {
  BTC: 89500,
  ETH: 2650,
  LTC: 72,
  USDT: 1,
  BNB: 680,
  MATIC: 0.45,
  TRX: 0.15,
};

const FALLBACK_FIAT_RATES: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.78,
  INR: 86.8,
  CAD: 1.38,
  AUD: 1.52,
  JPY: 154.2,
  CNY: 7.24,
  AED: 3.67,
  SAR: 3.75,
  BRL: 5.65,
  RUB: 96.5,
  TRY: 34.5,
  NGN: 1550,
  KES: 129,
  GHS: 15.8,
  PKR: 278,
  BDT: 120,
  VND: 25400,
  THB: 34.2,
  IDR: 15900,
  MYR: 4.45,
  PHP: 58.5,
  SGD: 1.34,
};

export function PriceProvider({ children }: { children: ReactNode }) {
  const [prices, setPrices] = useState<Record<CryptoCurrency, number>>(FALLBACK_PRICES);
  const [fiatRates, setFiatRates] = useState<Record<string, number>>(FALLBACK_FIAT_RATES);
  const [isLoading, setIsLoading] = useState(false);
  const isFetchingRef = useRef(false);

  const fetchPrices = useCallback(async () => {
    if (isFetchingRef.current) return;
    isFetchingRef.current = true;

    try {
      const newPrices: Partial<Record<CryptoCurrency, number>> = {};
      let newFiatRates: Record<string, number> | null = null;

      // 1. Primary fetch: Internal P2P market prices endpoint with timeout
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 5000);

        const marketRes = await fetch('/api/p2p/market-prices?fiat=USD', {
          cache: 'no-store',
          signal: controller.signal,
          headers: { Accept: 'application/json' },
        });
        clearTimeout(timeoutId);

        if (marketRes.ok) {
          const marketData = await marketRes.json();
          if (marketData.prices && Array.isArray(marketData.prices)) {
            marketData.prices.forEach((item: { asset_symbol: string; price_in_fiat: number }) => {
              if (item.asset_symbol && typeof item.price_in_fiat === 'number' && item.price_in_fiat > 0) {
                newPrices[item.asset_symbol as CryptoCurrency] = item.price_in_fiat;
              }
            });
          }
        }
      } catch {
        // Internal endpoint unreachable (e.g. dev startup or offline), fallback quietly
      }

      // 2. Secondary fallback: Public ticker if internal had no crypto prices
      if (Object.keys(newPrices).length === 0) {
        try {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 4000);
          const binanceRes = await fetch(
            'https://api.binance.com/api/v3/ticker/price?symbols=%5B%22BTCUSDT%22,%22ETHUSDT%22,%22LTCUSDT%22%5D',
            { cache: 'no-store', signal: controller.signal }
          );
          clearTimeout(timeoutId);

          if (binanceRes.ok) {
            const list = await binanceRes.json();
            if (Array.isArray(list)) {
              list.forEach((item: { symbol: string; price: string }) => {
                const sym = item.symbol.replace('USDT', '') as CryptoCurrency;
                const p = parseFloat(item.price);
                if (!isNaN(p) && p > 0) {
                  newPrices[sym] = p;
                }
              });
              newPrices.USDT = 1;
            }
          }
        } catch {
          // Keep default fallback prices
        }
      }

      // 3. Update crypto prices if any were fetched
      if (Object.keys(newPrices).length > 0) {
        setPrices((prev) => ({
          ...prev,
          ...newPrices,
          USDT: newPrices.USDT || 1.0,
        }));
      }

      // 4. Fiat exchange rates fetch with timeout and error protection
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4000);
        const fiatRes = await fetch('https://open.er-api.com/v6/latest/USD', {
          cache: 'no-store',
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (fiatRes.ok) {
          const fiatData = await fiatRes.json();
          if (fiatData?.result === 'success' && fiatData.rates) {
            newFiatRates = { USD: 1, ...fiatData.rates };
          }
        }
      } catch {
        // Ignore fiat network errors; fallback rates will remain in place
      }

      if (newFiatRates) {
        setFiatRates((prev) => ({ ...prev, ...newFiatRates }));
      }
    } catch (err) {
      console.warn('Notice: Market prices refresh could not complete, using cached prices.', err);
    } finally {
      setIsLoading(false);
      isFetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    let isCancelled = false;

    // Initial fetch
    fetchPrices();

    // 30-second polling interval
    const interval = setInterval(() => {
      if (!isCancelled) {
        fetchPrices();
      }
    }, 30000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [fetchPrices]);

  return (
    <PriceContext.Provider
      value={{
        prices,
        fiatRates,
        isLoading,
        loadingPrice: isLoading,
        refreshPrices: fetchPrices,
      }}
    >
      {children}
    </PriceContext.Provider>
  );
}

export function usePrices() {
  const context = useContext(PriceContext);
  if (context === undefined) {
    throw new Error('usePrices must be used within a PriceProvider');
  }
  return context;
}
