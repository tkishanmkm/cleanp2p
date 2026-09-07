'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

export interface WalletAsset {
  asset_symbol: string;
  available: number;
  locked?: number;
}

export default function WalletBalances({
  initialAssets = [],
  userId,
}: {
  initialAssets?: WalletAsset[];
  userId: string;
}) {
  const [assets, setAssets] = useState<WalletAsset[]>(initialAssets);

  useEffect(() => {
    if (!userId) return;

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
          console.log('⚡ Realtime Balance Update Received:', payload.new);

          if (payload.new && payload.new.asset_symbol) {
            // 2. Reactively update state with new available/locked values
            setAssets((prevAssets) => {
              const exists = prevAssets.some(
                (a) => a.asset_symbol.toUpperCase() === String(payload.new.asset_symbol).toUpperCase()
              );
              if (exists) {
                return prevAssets.map((asset) =>
                  asset.asset_symbol.toUpperCase() === String(payload.new.asset_symbol).toUpperCase()
                    ? {
                        ...asset,
                        available: Number(payload.new.available || 0),
                        locked: Number(payload.new.locked || 0),
                      }
                    : asset
                );
              } else {
                return [
                  ...prevAssets,
                  {
                    asset_symbol: String(payload.new.asset_symbol).toUpperCase(),
                    available: Number(payload.new.available || 0),
                    locked: Number(payload.new.locked || 0),
                  },
                ];
              }
            });
          }
        }
      )
      .subscribe((status) => {
        console.log('Realtime Channel Status:', status);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId]);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {assets.map((asset) => (
        <div key={asset.asset_symbol} className="p-4 border border-border/40 bg-card rounded-lg shadow-sm">
          <h3 className="text-lg font-bold">{asset.asset_symbol}</h3>
          <p className="text-2xl font-mono text-green-600 dark:text-green-400 font-semibold">
            {asset.available}
          </p>
          {typeof asset.locked === 'number' && asset.locked > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Locked: {asset.locked}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
