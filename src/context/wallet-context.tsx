'use client';

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/auth-provider';
import { usePrices } from '@/context/price-context';
import type { CryptoCurrency } from '@/lib/types';
import { SUPPORTED_CRYPTOS } from '@/lib/constants';
import { clearPendingWithdrawalKey, getOrCreatePendingWithdrawalKeyDetails } from '@/lib/withdrawal-idempotency-store';

export interface AssetBalanceData {
  available: number;
  inEscrow: number;
  inWithdrawal: number;
  total: number;
  fiatValue: number;
}

export type WalletBalancesMap = Record<CryptoCurrency, AssetBalanceData>;

interface WalletContextType {
  balances: WalletBalancesMap;
  totalAvailableUsdValue: number;
  totalPortfolioUsdValue: number;
  totalConvertedValue: number;
  totalPortfolioConvertedValue: number;
  totalCoinsCount: number;
  totalFundedCoinsCount: number;
  totalCoinUnits: number;
  preferredCurrency: string;
  isLoading: boolean;
  error: string | null;
  refreshBalances: () => Promise<void>;
  requestWithdrawal: (
    asset: CryptoCurrency,
    chain: string,
    toAddress: string,
    amount: number,
    fee?: number,
    totpCode?: string
  ) => Promise<{ success: boolean; withdrawal_id?: string }>;
}

const defaultBalances: WalletBalancesMap = {
  BTC: { available: 0, inEscrow: 0, inWithdrawal: 0, total: 0, fiatValue: 0 },
  ETH: { available: 0, inEscrow: 0, inWithdrawal: 0, total: 0, fiatValue: 0 },
  LTC: { available: 0, inEscrow: 0, inWithdrawal: 0, total: 0, fiatValue: 0 },
  USDT: { available: 0, inEscrow: 0, inWithdrawal: 0, total: 0, fiatValue: 0 },
  BNB: { available: 0, inEscrow: 0, inWithdrawal: 0, total: 0, fiatValue: 0 },
  TRX: { available: 0, inEscrow: 0, inWithdrawal: 0, total: 0, fiatValue: 0 },
};

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const { prices = { BTC: 0, ETH: 0, LTC: 0, USDT: 1, BNB: 0, TRX: 0 }, fiatRates = { USD: 1 } } = usePrices();

  const [rawBalances, setRawBalances] = useState<{
    [key in CryptoCurrency]: { available: number; inEscrow: number; inWithdrawal: number };
  }>({
    BTC: { available: 0, inEscrow: 0, inWithdrawal: 0 },
    ETH: { available: 0, inEscrow: 0, inWithdrawal: 0 },
    LTC: { available: 0, inEscrow: 0, inWithdrawal: 0 },
    USDT: { available: 0, inEscrow: 0, inWithdrawal: 0 },
    BNB: { available: 0, inEscrow: 0, inWithdrawal: 0 },
    TRX: { available: 0, inEscrow: 0, inWithdrawal: 0 },
  });

  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const userId = user?.id || user?.uid || null;
  const preferredCurrency = profile?.preferredCurrency || profile?.preferred_currency || 'USD';
  const exchangeRate = (fiatRates && fiatRates[preferredCurrency]) ? fiatRates[preferredCurrency] : (fiatRates?.['USD'] || 1);

  const fetchBalances = useCallback(async () => {
    if (!userId) {
      setRawBalances({
        BTC: { available: 0, inEscrow: 0, inWithdrawal: 0 },
        ETH: { available: 0, inEscrow: 0, inWithdrawal: 0 },
        LTC: { available: 0, inEscrow: 0, inWithdrawal: 0 },
        USDT: { available: 0, inEscrow: 0, inWithdrawal: 0 },
        BNB: { available: 0, inEscrow: 0, inWithdrawal: 0 },
        TRX: { available: 0, inEscrow: 0, inWithdrawal: 0 },
      });
      setIsLoading(false);
      return;
    }

    try {
      const nextMap: { [key in CryptoCurrency]: { available: number; inEscrow: number; inWithdrawal: number } } = {
        BTC: { available: 0, inEscrow: 0, inWithdrawal: 0 },
        ETH: { available: 0, inEscrow: 0, inWithdrawal: 0 },
        LTC: { available: 0, inEscrow: 0, inWithdrawal: 0 },
        USDT: { available: 0, inEscrow: 0, inWithdrawal: 0 },
        BNB: { available: 0, inEscrow: 0, inWithdrawal: 0 },
        TRX: { available: 0, inEscrow: 0, inWithdrawal: 0 },
      };

      // 1. Primary: Server-side API endpoint with admin privileges and RLS bypass
      let apiSuccess = false;
      try {
        if (userId) {
          const res = await fetch(`/api/wallet/balance?userId=${encodeURIComponent(userId)}`, {
            cache: 'no-store',
          });
          if (res.ok) {
            const apiData = await res.json();
            if (apiData?.success && apiData?.balances) {
              (Object.keys(apiData.balances) as CryptoCurrency[]).forEach((coin) => {
                if (nextMap[coin]) {
                  const coinItem = apiData.balances[coin];
                  const avail = Number(coinItem.available ?? 0);
                  const escrow = Number(coinItem.inEscrow ?? 0);
                  const withdraw = Number(coinItem.inWithdrawal ?? 0);

                  nextMap[coin] = {
                    available: Math.max(0, isNaN(avail) ? 0 : avail),
                    inEscrow: Math.max(0, isNaN(escrow) ? 0 : escrow),
                    inWithdrawal: Math.max(0, isNaN(withdraw) ? 0 : withdraw),
                  };
                }
              });
              apiSuccess = true;
            }
          }
        }
      } catch (apiErr) {
        console.debug('[WalletProvider] /api/wallet/balance fetch note:', apiErr);
      }

      // Fail closed: never replace an unavailable authoritative balance API with
      // browser-side queries against legacy wallet/profile tables or stale local data.
      if (!apiSuccess) {
        // Preserve the last displayed snapshot but mark it unavailable/stale;
        // never replace it with fabricated zeroes or legacy/cache data.
        setError('Live wallet balances are temporarily unavailable. Please retry shortly.');
        setIsLoading(false);
        return;
      }

      // The authenticated balance API is the sole source of displayed balances.
      // Do not supplement a valid response with profile or localStorage snapshots.
      setRawBalances(nextMap);
      setError(null);
    } catch (err: any) {
      console.error('[WalletProvider] Error fetching live balances:', err);
      setError(err?.message || 'Failed to fetch balances');
    } finally {
      setIsLoading(false);
    }
  }, [userId, profile]);

  // Initial fetch and Realtime listeners
  useEffect(() => {
    fetchBalances();

    if (!userId) return;

    // Realtime channel for live balance synchronization
    const channelName = `realtime_wallet_sync_${userId.replace(/[^a-zA-Z0-9]/g, '_')}`;
    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'wallet_assets',
        },
        () => {
          fetchBalances();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'wallet_transactions',
        },
        () => {
          fetchBalances();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'withdrawals',
        },
        () => {
          fetchBalances();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'deposits',
        },
        () => {
          fetchBalances();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'user_wallets',
        },
        () => {
          fetchBalances();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trades',
        },
        () => {
          fetchBalances();
        }
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'profiles',
        },
        () => {
          fetchBalances();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, fetchBalances]);

  // Compute structured balances with live USD/Fiat values
  const balances: WalletBalancesMap = useMemo(() => {
    const calculated: WalletBalancesMap = { ...defaultBalances };

    (Object.keys(rawBalances) as CryptoCurrency[]).forEach((coin) => {
      const data = rawBalances[coin] || { available: 0, inEscrow: 0, inWithdrawal: 0 };
      const coinPrice = (prices as Record<string, number | undefined>)?.[coin] ?? (coin === 'USDT' ? 1 : 0);
      const totalCoin = (data.available || 0) + (data.inEscrow || 0) + (data.inWithdrawal || 0);
      const fiatVal = (data.available || 0) * (coinPrice || 0) * (exchangeRate || 1);

      calculated[coin] = {
        available: data.available || 0,
        inEscrow: data.inEscrow || 0,
        inWithdrawal: data.inWithdrawal || 0,
        total: totalCoin,
        fiatValue: fiatVal,
      };
    });

    return calculated;
  }, [rawBalances, prices, exchangeRate]);

  // Compute Platform-Wide Consolidated Values
  const totalAvailableUsdValue = useMemo(() => {
    return (Object.keys(balances) as CryptoCurrency[]).reduce((sum, coin) => {
      const coinPrice = (prices as Record<string, number | undefined>)?.[coin] ?? (coin === 'USDT' ? 1 : 0);
      return sum + (balances[coin].available || 0) * coinPrice;
    }, 0);
  }, [balances, prices]);

  const totalPortfolioUsdValue = useMemo(() => {
    return (Object.keys(balances) as CryptoCurrency[]).reduce((sum, coin) => {
      const coinPrice = (prices as Record<string, number | undefined>)?.[coin] ?? (coin === 'USDT' ? 1 : 0);
      return sum + (balances[coin].total || 0) * coinPrice;
    }, 0);
  }, [balances, prices]);

  const totalConvertedValue = useMemo(() => {
    return totalAvailableUsdValue * exchangeRate;
  }, [totalAvailableUsdValue, exchangeRate]);

  const totalPortfolioConvertedValue = useMemo(() => {
    return totalPortfolioUsdValue * exchangeRate;
  }, [totalPortfolioUsdValue, exchangeRate]);

  // Number of supported cryptos and number of funded coin wallets
  const totalCoinsCount = useMemo(() => {
    return SUPPORTED_CRYPTOS.length;
  }, []);

  const totalFundedCoinsCount = useMemo(() => {
    return (Object.keys(balances) as CryptoCurrency[]).filter(
      (c) => (balances[c]?.available || 0) > 0 || (balances[c]?.inEscrow || 0) > 0 || (balances[c]?.inWithdrawal || 0) > 0
    ).length;
  }, [balances]);

  const totalCoinUnits = useMemo(() => {
    return (Object.keys(balances) as CryptoCurrency[]).reduce(
      (sum, coin) => sum + (balances[coin].available || 0),
      0
    );
  }, [balances]);

  // Unified Request Withdrawal Action with Instant Optimistic Update
  const handleRequestWithdrawal = useCallback(
    async (
      asset: CryptoCurrency,
      chain: string,
      toAddress: string,
      amount: number,
      fee: number = 0,
      totpCode?: string
    ) => {
      if (!userId) {
        throw new Error('Authentication required');
      }

      const totalDeduction = amount + fee;

      // Persist the retry key across reloads and tabs. Exclude the displayed fee:
      // the server recalculates it authoritatively, and a changed fee must not turn
      // an ambiguous retry into a second withdrawal intent.
      const withdrawalFingerprint = JSON.stringify([asset, chain, toAddress.trim(), amount]);
      const retry = await getOrCreatePendingWithdrawalKeyDetails(userId, withdrawalFingerprint);
      const idempotencyKey = retry.key;

      // If this intent already has a key, it may have reserved funds on the server
      // even if the prior response was lost. Let the idempotent server replay decide
      // the outcome instead of rejecting it against the now-lower displayed balance.
      if (balances[asset].available < totalDeduction && !retry.reused) {
        await clearPendingWithdrawalKey(userId, withdrawalFingerprint, idempotencyKey);
        throw new Error(`Insufficient available balance. Available: ${balances[asset].available} ${asset}`);
      }

      // Only apply an optimistic debit for a genuinely new intent. A retry must not
      // locally deduct the same amount twice while the server resolves the old key.
      if (!retry.reused) {
        setRawBalances((prev) => {
          const updated = {
            ...prev,
            [asset]: {
              ...prev[asset],
              available: Math.max(0, prev[asset].available - totalDeduction),
              inWithdrawal: prev[asset].inWithdrawal + totalDeduction,
            },
          };
          return updated;
        });
      }

      try {
        const res = await fetch('/api/withdraw', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-idempotency-key': idempotencyKey,
          },
          body: JSON.stringify({
            asset,
            chain,
            destinationAddress: toAddress,
            amount,
            fee,
            totpCode: totpCode || '',
          }),
        });

        const resData = await res.json();
        const withdrawalId = resData?.withdrawalId || resData?.withdrawal_id;
        if (
          !res.ok ||
          resData?.success !== true ||
          typeof withdrawalId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(withdrawalId)
        ) {
          // Keep the key when the outcome is not definitively acknowledged. A retry
          // must query/replay the original reservation instead of creating a new one.
          throw new Error(resData?.error || 'Withdrawal request could not be confirmed. Check withdrawal history before retrying.');
        }

        await clearPendingWithdrawalKey(userId, withdrawalFingerprint, idempotencyKey);
        await fetchBalances();
        return { success: true, withdrawal_id: withdrawalId };
      } catch (err: any) {
        // Rollback optimistic update
        await fetchBalances();
        throw err;
      }
    },
    [userId, balances, fetchBalances]
  );

  const value = useMemo<WalletContextType>(() => ({
    balances,
    totalAvailableUsdValue,
    totalPortfolioUsdValue,
    totalConvertedValue,
    totalPortfolioConvertedValue,
    totalCoinsCount,
    totalFundedCoinsCount,
    totalCoinUnits,
    preferredCurrency,
    isLoading,
    error,
    refreshBalances: fetchBalances,
    requestWithdrawal: handleRequestWithdrawal,
  }), [
    balances,
    totalAvailableUsdValue,
    totalPortfolioUsdValue,
    totalConvertedValue,
    totalPortfolioConvertedValue,
    totalCoinsCount,
    totalFundedCoinsCount,
    totalCoinUnits,
    preferredCurrency,
    isLoading,
    error,
    fetchBalances,
    handleRequestWithdrawal,
  ]);

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error('useWallet must be used within a WalletProvider');
  }
  return context;
}
