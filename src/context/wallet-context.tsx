'use client';

import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useAuth } from '@/components/providers/auth-provider';
import { usePrices } from '@/context/price-context';
import type { CryptoCurrency } from '@/lib/types';
import { SUPPORTED_CRYPTOS } from '@/lib/constants';

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
    fee?: number
  ) => Promise<{ success: boolean; withdrawal_id?: string }>;
}

const defaultBalances: WalletBalancesMap = {
  BTC: { available: 0, inEscrow: 0, inWithdrawal: 0, total: 0, fiatValue: 0 },
  ETH: { available: 0, inEscrow: 0, inWithdrawal: 0, total: 0, fiatValue: 0 },
  LTC: { available: 0, inEscrow: 0, inWithdrawal: 0, total: 0, fiatValue: 0 },
  USDT: { available: 0, inEscrow: 0, inWithdrawal: 0, total: 0, fiatValue: 0 },
};

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { user, profile } = useAuth();
  const { prices = { BTC: 0, ETH: 0, LTC: 0, USDT: 1 }, fiatRates = { USD: 1 } } = usePrices();

  const [rawBalances, setRawBalances] = useState<{
    [key in CryptoCurrency]: { available: number; inEscrow: number; inWithdrawal: number };
  }>({
    BTC: { available: 0, inEscrow: 0, inWithdrawal: 0 },
    ETH: { available: 0, inEscrow: 0, inWithdrawal: 0 },
    LTC: { available: 0, inEscrow: 0, inWithdrawal: 0 },
    USDT: { available: 0, inEscrow: 0, inWithdrawal: 0 },
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
      };

      // 1. Fetch wallet_assets by user_id (Direct Table Mapping)
      try {
        const { data: directAssets, error: directError } = await supabase
          .from('wallet_assets')
          .select('asset_symbol, asset_code, available, balance, locked, locked_escrow, locked_withdrawal')
          .eq('user_id', userId);

        if (!directError && directAssets && directAssets.length > 0) {
          directAssets.forEach((row: any) => {
            const sym = String(row.asset_symbol || row.asset_code || '').toUpperCase() as CryptoCurrency;
            if (sym && nextMap[sym]) {
              const avail = Number(row.available ?? row.balance ?? 0);
              const escrow = Number(row.locked_escrow ?? row.locked ?? 0);
              const withdraw = Number(row.locked_withdrawal ?? 0);

              nextMap[sym] = {
                available: Math.max(0, avail),
                inEscrow: Math.max(0, escrow),
                inWithdrawal: Math.max(0, withdraw),
              };
            }
          });
        }
      } catch (err) {
        console.warn('Direct wallet_assets check warning:', err);
      }

      // 2. Query via wallets relation if available
      try {
        const { data: walletData } = await supabase
          .from('wallets')
          .select('id')
          .eq('user_id', userId)
          .maybeSingle();

        if (walletData?.id) {
          const { data: walletAssets } = await supabase
            .from('wallet_assets')
            .select('asset_symbol, asset_code, available, balance, locked, locked_escrow, locked_withdrawal')
            .eq('wallet_id', walletData.id);

          if (walletAssets && walletAssets.length > 0) {
            walletAssets.forEach((row: any) => {
              const sym = String(row.asset_symbol || row.asset_code || '').toUpperCase() as CryptoCurrency;
              if (sym && nextMap[sym]) {
                const avail = Number(row.available ?? row.balance ?? 0);
                const escrow = Number(row.locked_escrow ?? row.locked ?? 0);
                const withdraw = Number(row.locked_withdrawal ?? 0);

                if (avail > 0 || nextMap[sym].available === 0) {
                  nextMap[sym] = {
                    available: Math.max(0, avail),
                    inEscrow: Math.max(0, escrow),
                    inWithdrawal: Math.max(0, withdraw),
                  };
                }
              }
            });
          }
        }
      } catch (err) {
        console.warn('Wallets relation query warning:', err);
      }

      // 3. Fallback check user_wallets table
      try {
        const { data: userWallets } = await supabase
          .from('user_wallets')
          .select('asset_symbol, balance, available_balance, locked_balance')
          .eq('user_id', userId);

        if (userWallets && userWallets.length > 0) {
          userWallets.forEach((row: any) => {
            const sym = String(row.asset_symbol || '').toUpperCase() as CryptoCurrency;
            if (sym && nextMap[sym]) {
              const avail = Number(row.available_balance ?? row.balance ?? 0);
              const escrow = Number(row.locked_balance ?? 0);
              if (avail > 0 || nextMap[sym].available === 0) {
                nextMap[sym] = {
                  available: Math.max(0, avail),
                  inEscrow: Math.max(0, escrow),
                  inWithdrawal: nextMap[sym].inWithdrawal,
                };
              }
            }
          });
        }
      } catch (err) {
        console.warn('user_wallets fallback check warning:', err);
      }

      // 4. Check profiles table directly
      try {
        const { data: profileRow } = await supabase
          .from('profiles')
          .select('btc_balance, eth_balance, usdt_balance, ltc_balance, btcBalance, ethBalance, usdtBalance, ltcBalance, wallets')
          .or(`id.eq.${userId},user_id.eq.${userId}`)
          .maybeSingle();

        if (profileRow) {
          const btc = Number(profileRow.btc_balance ?? profileRow.btcBalance ?? profileRow.wallets?.BTC?.balance ?? 0);
          const eth = Number(profileRow.eth_balance ?? profileRow.ethBalance ?? profileRow.wallets?.ETH?.balance ?? 0);
          const ltc = Number(profileRow.ltc_balance ?? profileRow.ltcBalance ?? profileRow.wallets?.LTC?.balance ?? 0);
          const usdt = Number(profileRow.usdt_balance ?? profileRow.usdtBalance ?? profileRow.wallets?.USDT?.balance ?? 0);

          if (btc > 0 && nextMap['BTC'].available === 0) nextMap['BTC'].available = btc;
          if (eth > 0 && nextMap['ETH'].available === 0) nextMap['ETH'].available = eth;
          if (ltc > 0 && nextMap['LTC'].available === 0) nextMap['LTC'].available = ltc;
          if (usdt > 0 && nextMap['USDT'].available === 0) nextMap['USDT'].available = usdt;
        }
      } catch (err) {
        console.warn('Profiles balance check warning:', err);
      }

      // 5. Fallback to auth profile in memory
      if (profile) {
        const btc = Number(profile.btc_balance ?? profile.btcBalance ?? profile.wallets?.BTC?.balance ?? 0);
        const eth = Number(profile.eth_balance ?? profile.ethBalance ?? profile.wallets?.ETH?.balance ?? 0);
        const ltc = Number(profile.ltc_balance ?? profile.ltcBalance ?? profile.wallets?.LTC?.balance ?? 0);
        const usdt = Number(profile.usdt_balance ?? profile.usdtBalance ?? profile.wallets?.USDT?.balance ?? 0);

        if (btc > 0 && nextMap['BTC'].available === 0) nextMap['BTC'].available = btc;
        if (eth > 0 && nextMap['ETH'].available === 0) nextMap['ETH'].available = eth;
        if (ltc > 0 && nextMap['LTC'].available === 0) nextMap['LTC'].available = ltc;
        if (usdt > 0 && nextMap['USDT'].available === 0) nextMap['USDT'].available = usdt;
      }

      // 6. Check localStorage cache for instant persistence if DB is in transition
      if (typeof window !== 'undefined') {
        try {
          const cachedStr = localStorage.getItem(`wallet_cache_${userId}`);
          if (cachedStr) {
            const cached = JSON.parse(cachedStr);
            (Object.keys(cached) as CryptoCurrency[]).forEach((sym) => {
              if (nextMap[sym] && nextMap[sym].available === 0 && Number(cached[sym]?.available) > 0) {
                nextMap[sym] = {
                  available: Number(cached[sym].available || 0),
                  inEscrow: Number(cached[sym].inEscrow || 0),
                  inWithdrawal: Number(cached[sym].inWithdrawal || 0),
                };
              }
            });
          }
        } catch {}
      }

      setRawBalances(nextMap);
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(`wallet_cache_${userId}`, JSON.stringify(nextMap));
        } catch {}
      }
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
      const coinPrice = prices?.[coin] ?? (coin === 'USDT' ? 1 : 0);
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
      const coinPrice = prices?.[coin] ?? (coin === 'USDT' ? 1 : 0);
      return sum + (balances[coin].available || 0) * coinPrice;
    }, 0);
  }, [balances, prices]);

  const totalPortfolioUsdValue = useMemo(() => {
    return (Object.keys(balances) as CryptoCurrency[]).reduce((sum, coin) => {
      const coinPrice = prices?.[coin] ?? (coin === 'USDT' ? 1 : 0);
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
      fee: number = 0
    ) => {
      if (!userId) {
        throw new Error('Authentication required');
      }

      const totalDeduction = amount + fee;
      if (balances[asset].available < totalDeduction) {
        throw new Error(`Insufficient available balance. Available: ${balances[asset].available} ${asset}`);
      }

      // Optimistic balance update
      setRawBalances((prev) => {
        const updated = {
          ...prev,
          [asset]: {
            ...prev[asset],
            available: Math.max(0, prev[asset].available - totalDeduction),
            inWithdrawal: prev[asset].inWithdrawal + totalDeduction,
          },
        };
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem(`wallet_cache_${userId}`, JSON.stringify(updated));
          } catch {}
        }
        return updated;
      });

      try {
        const { data, error: rpcError } = await supabase.rpc('request_withdrawal', {
          p_asset_code: asset,
          p_network_code: chain,
          p_destination_address: toAddress,
          p_amount: amount,
          p_idempotency_key: `wd_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
        });

        if (rpcError) {
          throw new Error(rpcError.message);
        }

        await fetchBalances();
        return { success: true, withdrawal_id: data?.withdrawal_id };
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
