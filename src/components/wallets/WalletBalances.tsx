'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';
import { normalizePrimaryWalletAssetBalance } from '@/lib/wallet-balance-normalization';

export interface WalletAsset {
  asset_symbol: string;
  available: number;
  reserved?: number;
  inEscrow?: number;
  inWithdrawal?: number;
  locked?: number;
}

function mapWalletAsset(row: Record<string, unknown>): WalletAsset | null {
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
  };
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
            if (!mapped) return;

            setAssets((previous) => {
              const exists = previous.some(
                (asset) => asset.asset_symbol.toUpperCase() === mapped.asset_symbol
              );
              if (exists) {
                return previous.map((asset) =>
                  asset.asset_symbol.toUpperCase() === mapped.asset_symbol ? mapped : asset
                );
              }
              return [...previous, mapped];
            });
          }
        }
      )
      .subscribe();

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
              Held: {asset.locked}
            </p>
          )}
        </div>
      ))}
    </div>
  );
}
