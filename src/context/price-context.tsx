'use client';

import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import type { CryptoCurrency } from '@/lib/types';
import { useFirebase } from '@/firebase';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { SUPPORTED_CRYPTOS } from '@/lib/constants';

interface PriceContextType {
  prices: Record<CryptoCurrency, number>;
  fiatRates: Record<string, number>;
  isLoading: boolean;
}

const PriceContext = createContext<PriceContextType | undefined>(undefined);

export function PriceProvider({ children }: { children: ReactNode }) {
  const { firestore } = useFirebase();

  const [prices, setPrices] = useState<Record<CryptoCurrency, number>>({
    BTC: 0,
    ETH: 0,
    LTC: 0,
    USDT: 1,
  });

  const [fiatRates, setFiatRates] = useState<Record<string, number>>({ USD: 1 });
  const [isLoading, setIsLoading] = useState(true);

  // This effect listens for real-time updates from Firestore, which acts as our cache.
  // This provides "Instant Price Loading" and "Real-time Synchronization".
  useEffect(() => {
    if (!firestore) {
      // If firestore is not ready, we are technically still loading.
      return;
    }

    const marketDataRef = doc(firestore, '_config', 'market_data');
    
    const unsubscribe = onSnapshot(marketDataRef, (doc) => {
      if (doc.exists()) {
        const data = doc.data();
        if (data.prices) setPrices(prev => ({...prev, ...data.prices}));
        if (data.fiatRates) setFiatRates(data.fiatRates);
      }
      // We set loading to false after the first read from cache.
      if (isLoading) {
          setIsLoading(false);
      }
    }, (error) => {
      console.error("Error with price listener:", error);
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [firestore, isLoading]);


  // This effect runs in the background to fetch new data and update the cache ("Database Sync").
  useEffect(() => {
    const fetchAndCachePrices = async () => {
        if (!firestore) return;

        const coingeckoIds: Record<CryptoCurrency, string> = {
            BTC: 'bitcoin',
            ETH: 'ethereum',
            LTC: 'litecoin',
            USDT: 'tether',
        };
        const ids = SUPPORTED_CRYPTOS.map(c => coingeckoIds[c.name]).join(',');

        try {
            const [cryptoRes, fiatRes] = await Promise.all([
                fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`),
                fetch('https://open.er-api.com/v6/latest/USD')
            ]);
            
            const marketDataRef = doc(firestore, '_config', 'market_data');
            const updateData: any = {};

            if (cryptoRes.ok) {
                const cryptoData = await cryptoRes.json();
                const newPrices: Partial<Record<CryptoCurrency, number>> = {};
                for (const crypto of SUPPORTED_CRYPTOS) {
                    const coingeckoId = coingeckoIds[crypto.name];
                    if (cryptoData[coingeckoId] && cryptoData[coingeckoId].usd) {
                        newPrices[crypto.name] = cryptoData[coingeckoId].usd;
                    }
                }
                newPrices.USDT = 1.00;
                updateData.prices = newPrices;
            }
            
            if (fiatRes.ok) {
                const fiatData = await fiatRes.json();
                if (fiatData.result === 'success') {
                    updateData.fiatRates = { USD: 1, ...fiatData.rates };
                }
            }

            if (Object.keys(updateData).length > 0) {
                 // Non-blocking update to firestore
                 setDoc(marketDataRef, updateData, { merge: true }).catch(err => {
                     console.error("Failed to update price cache:", err);
                 });
            }

        } catch (error) {
            console.error("Error fetching and caching price data:", error);
        }
    };
    
    // Fetch immediately on mount
    fetchAndCachePrices();

    // Then fetch every 30 seconds ("Background Updates")
    const interval = setInterval(fetchAndCachePrices, 30000); 

    return () => clearInterval(interval);
  }, [firestore]);


  return (
    <PriceContext.Provider value={{ prices, fiatRates, isLoading }}>
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
