'use client';

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import { normalizePrimaryWalletAssetBalance } from '@/lib/wallet-balance-normalization';

export interface WalletAssetItem {
  asset_symbol: string;
  available: number;
  reserved: number;
  inEscrow: number;
  inWithdrawal: number;
  locked: number;
  updated_at?: string;
}

const DEFAULT_ASSETS: WalletAssetItem[] = ['BTC', 'ETH', 'LTC', 'USDT'].map((asset_symbol) => ({
  asset_symbol,
  available: 0,
  reserved: 0,
  inEscrow: 0,
  inWithdrawal: 0,
  locked: 0,
}));

function mapWalletAsset(row: Record<string, unknown>): WalletAssetItem | null {
  const assetSymbol = String(row.asset_symbol || '').trim().toUpperCase();
  if (!assetSymbol) return null;

  const normalized = normalizePrimaryWalletAssetBalance(row);
  if (!normalized.accountingValid) return null;

  return {
    asset_symbol: assetSymbol,
    available: normalized.available,
    reserved: normalized.reserved,
    inEscrow: normalized.inEscrow,
    inWithdrawal: normalized.inWithdrawal,
    locked: normalized.reserved + normalized.inEscrow + normalized.inWithdrawal,
    updated_at: typeof row.updated_at === 'string' ? row.updated_at : undefined,
  };
}

export function useRealtimeWallets(userId: string | undefined | null) {
  const [assets, setAssets] = useState<WalletAssetItem[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchInitialAssets = useCallback(async (uid: string) => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('wallet_assets')
        .select('asset_symbol,balance,locked_balance,reserved_balance,in_escrow,in_withdrawal,updated_at')
        .eq('user_id', uid)
        .order('asset_symbol', { ascending: true });

      if (error) {
        console.error('[useRealtimeWallets] Canonical wallet asset query failed:', error.code || 'unknown');
        setAssets(DEFAULT_ASSETS);
        return;
      }

      const mapped = (data || [])
        .map((item) => mapWalletAsset(item as unknown as Record<string, unknown>))
        .filter((item): item is WalletAssetItem => item !== null);

      setAssets(mapped.length > 0 ? mapped : DEFAULT_ASSETS);
    } catch (error: unknown) {
      console.error(
        '[useRealtimeWallets] Canonical wallet asset query failed:',
        error instanceof Error ? error.name : 'UnknownError'
      );
      setAssets(DEFAULT_ASSETS);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!userId) {
      setAssets(DEFAULT_ASSETS);
      setLoading(false);
      return;
    }

    fetchInitialAssets(userId);

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
          if (payload.new && payload.new.asset_symbol) {
            const mapped = mapWalletAsset(payload.new as Record<string, unknown>);
            if (!mapped) {
              fetchInitialAssets(userId);
              return;
            }

            setAssets((previous) => {
              const exists = previous.some((item) => item.asset_symbol === mapped.asset_symbol);
              if (!exists) return [...previous, mapped];
              return previous.map((item) =>
                item.asset_symbol === mapped.asset_symbol ? mapped : item
              );
            });
          } else {
            fetchInitialAssets(userId);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, fetchInitialAssets]);

  return {
    assets,
    setAssets,
    loading,
    refresh: () => userId ? fetchInitialAssets(userId) : Promise.resolve(),
  };
}
