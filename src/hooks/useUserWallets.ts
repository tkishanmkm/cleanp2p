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
      // 1. Fetch current wallet records directly from public.wallets table
      const { data: dbWallets, error: fetchError } = await supabase
        .from('wallets')
        .select('chain, address')
        .eq('user_id', userId);

      if (fetchError) {
        throw fetchError;
      }

      // 2. Map existing records into a key-value object
      const walletMap: Record<string, string> = {};
      if (dbWallets) {
        dbWallets.forEach((item: { chain: string; address: string }) => {
          walletMap[item.chain] = item.address;
        });
      }

      // 3. Check for missing required chains
      const missingChains = REQUIRED_CHAINS.filter(
        (chain) => !walletMap[chain] || walletMap[chain].trim() === ''
      );

      // 4. Fallback auto-provisioning via API if any chain is unprovisioned
      if (missingChains.length > 0) {
        for (const chain of missingChains) {
          const res = await fetch('/api/wallet/deposit-address', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ userId, chain }),
          });

          if (res.ok) {
            const data = await res.json();
            if (data?.address) {
              walletMap[chain] = data.address;
            }
          }
        }
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
