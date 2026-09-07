'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import type { CryptoCurrency } from '@/lib/types';

export interface WalletAssetItem {
  asset_symbol: string;
  available: number;
  locked: number;
  updated_at?: string;
}

export function useRealtimeWallets(userId: string | undefined | null) {
  const [assets, setAssets] = useState<WalletAssetItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInitialAssets = useCallback(async (uid: string) => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('wallet_assets')
        .select('asset_symbol, available, locked, updated_at')
        .eq('user_id', uid);

      if (!error && data && data.length > 0) {
        setAssets(
          data.map((item: any) => ({
            asset_symbol: String(item.asset_symbol).toUpperCase(),
            available: Number(item.available || 0),
            locked: Number(item.locked || 0),
            updated_at: item.updated_at,
          }))
        );
      } else {
        // Fallback default assets
        setAssets([
          { asset_symbol: 'BTC', available: 0, locked: 0 },
          { asset_symbol: 'ETH', available: 0, locked: 0 },
          { asset_symbol: 'LTC', available: 0, locked: 0 },
          { asset_symbol: 'USDT', available: 0, locked: 0 },
        ]);
      }
    } catch (err) {
      console.error('[useRealtimeWallets] Failed to fetch initial assets:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    fetchInitialAssets(userId);

    // 1. Subscribe to changes on wallet_assets for this specific user
    const channel = supabase
      .channel(`realtime_wallet_assets_${userId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'wallet_assets',
          filter: `user_id=eq.${userId}`,
        },
        (payload: any) => {
          console.log('⚡ Realtime Balance Update Received:', payload.new || payload);

          if (payload.new && payload.new.asset_symbol) {
            const sym = String(payload.new.asset_symbol).toUpperCase();
            const avail = Number(payload.new.available || 0);
            const lock = Number(payload.new.locked || 0);

            // 2. Reactively update state with new available/locked values
            setAssets((prevAssets) => {
              const exists = prevAssets.some((a) => a.asset_symbol === sym);
              if (exists) {
                return prevAssets.map((asset) =>
                  asset.asset_symbol === sym
                    ? { ...asset, available: avail, locked: lock, updated_at: payload.new.updated_at }
                    : asset
                );
              } else {
                return [...prevAssets, { asset_symbol: sym, available: avail, locked: lock, updated_at: payload.new.updated_at }];
              }
            });
          } else {
            // Re-fetch on other changes
            fetchInitialAssets(userId);
          }
        }
      )
      .subscribe((status) => {
        console.log('Realtime Channel Status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, fetchInitialAssets]);

  return { assets, setAssets, loading, refresh: () => userId && fetchInitialAssets(userId) };
}
