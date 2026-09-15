import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabaseClient';

export type SupportedChain = 'BTC' | 'EVM' | 'TRON' | 'LTC';

export interface WalletRecord {
  chain: SupportedChain;
  address: string;
  derivation_index?: number;
  funding_status?: string;
}

export interface UseUserWalletsReturn {
  wallets: Record<SupportedChain, string>;
  loading: boolean;
  error: string | null;
  refreshWallets: () => Promise<void>;
}

const REQUIRED_CHAINS: SupportedChain[] = ['BTC', 'EVM', 'TRON', 'LTC'];

export function useUserWallets(userId: string | undefined): UseUserWalletsReturn {
  const [wallets, setWallets] = useState<Record<SupportedChain, string>>({
    BTC: '',
    EVM: '',
    TRON: '',
    LTC: '',
  });
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAndHydrateWallets = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Fetch authoritative derived addresses from API
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData?.session?.access_token;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (token) headers['Authorization'] = `Bearer ${token}`;
      headers['x-user-id'] = userId;

      const res = await fetch(`/api/wallet/deposit-address?user_id=${encodeURIComponent(userId)}`, {
        headers,
        credentials: 'same-origin',
      });

      if (res.ok) {
        const data = await res.json();
        if (data?.success && data?.addresses) {
          setWallets({
            BTC: data.addresses.btc || data.addresses.BTC || '',
            EVM: data.addresses.evm || data.addresses.ETH || '',
            TRON: data.addresses.tron || data.addresses.USDT_TRC20 || '',
            LTC: data.addresses.ltc || data.addresses.LTC || '',
          });
          setLoading(false);
          return;
        }
      }

      // 2. Fallback check from public.wallets table
      const { data: dbWallets, error: fetchError } = await supabase
        .from('wallets')
        .select('chain, address')
        .eq('user_id', userId);

      if (fetchError) {
        throw fetchError;
      }

      const walletMap: Record<string, string> = {};
      if (dbWallets) {
        dbWallets.forEach((item: { chain: string; address: string }) => {
          walletMap[item.chain] = item.address;
        });
      }

      setWallets({
        BTC: walletMap.BTC || '',
        EVM: walletMap.EVM || '',
        TRON: walletMap.TRON || '',
        LTC: walletMap.LTC || '',
      });
    } catch (err: any) {
      console.error('Failed to hydrate user wallets:', err);
      setError(err?.message || 'Failed to fetch user deposit addresses.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchAndHydrateWallets();

    if (!userId) return;

    // 5. Setup Realtime subscription for automatic lifecycle sync
    const subscription = supabase
      .channel(`user-wallets-${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'wallets',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          if (payload.new && 'chain' in payload.new && 'address' in payload.new) {
            const newRecord = payload.new as { chain: SupportedChain; address: string };
            setWallets((prev) => ({
              ...prev,
              [newRecord.chain]: newRecord.address,
            }));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(subscription);
    };
  }, [userId, fetchAndHydrateWallets]);

  return {
    wallets,
    loading,
    error,
    refreshWallets: fetchAndHydrateWallets,
  };
}
