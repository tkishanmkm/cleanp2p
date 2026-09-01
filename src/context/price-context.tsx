'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import type { CryptoCurrency } from '@/lib/types';

interface PriceContextType {
  prices: Record<CryptoCurrency, number>;
  fiatRates: Record<string, number>;
  isLoading: boolean;
  loadingPrice: boolean;
  refreshPrices: () => Promise<void>;
}

const PriceContext = createContext<PriceContextType | undefined>(undefined);

export function PriceProvider({ children }: { children: ReactNode }) {
  const [prices, setPrices] = useState<Record<CryptoCurrency, number>>({
    BTC: 0,
    ETH: 0,
    LTC: 0,
    USDT: 1,
  });

  const [fiatRates, setFiatRates] = useState<Record<string, number>>({ USD: 1 });
  const [isLoading, setIsLoading] = useState(true);

  const fetchPrices = useCallback(async () => {
    try {
      const [marketRes, fiatRes] = await Promise.all([
        fetch('/api/p2p/market-prices?fiat=USD', { cache: 'no-store' }),
        fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store' }).catch(() => null),
      ]);

      const newPrices: Partial<Record<CryptoCurrency, number>> = {};

      if (marketRes.ok) {
        const marketData = await marketRes.json();
        if (marketData.prices && Array.isArray(marketData.prices)) {
          marketData.prices.forEach((item: { asset_symbol: string; price_in_fiat: number }) => {
            newPrices[item.asset_symbol as CryptoCurrency] = item.price_in_fiat;
          });
        }
      }

      let newFiatRates: Record<string, number> | null = null;
      if (fiatRes && fiatRes.ok) {
        const fiatData = await fiatRes.json();
        if (fiatData?.result === 'success' && fiatData.rates) {
          newFiatRates = { USD: 1, ...fiatData.rates };
        }
      }

      if (Object.keys(newPrices).length > 0) {
        setPrices((prev) => ({
          ...prev,
          ...newPrices,
          USDT: newPrices.USDT || 1.0,
        }));
      }

      if (newFiatRates) {
        setFiatRates(newFiatRates);
      }
    } catch (err) {
      console.error('Error in PriceProvider fetching market prices:', err);
    } finally {
      setIsLoading(false);
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
