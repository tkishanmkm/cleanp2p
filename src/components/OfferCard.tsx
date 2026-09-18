'use client';

import React from 'react';
import Link from 'next/link';
import { usePresenceStatus, resolveUserLastSeen } from '@/lib/presence';

export interface OfferCardProps {
  offer: {
    id: string;
    type: string;
    asset_symbol: string;
    fiat_symbol: string;
    price: number;
    min_limit: number;
    max_limit: number;
    payment_methods?: string[];
    seller_username?: string;
    seller_is_online?: boolean;
    seller_last_seen?: string;
    completed_trades_count?: number;
    profiles?: {
      username?: string;
      is_online?: boolean;
      last_seen?: string;
      last_seen_at?: string;
      last_active?: string;
      completed_trades_count?: number;
    };
  };
}

export default function OfferCard({ offer }: OfferCardProps) {
  const isSellerAd = offer.type === 'sell';
  const username = offer.seller_username || offer.profiles?.username || 'unnamed_trader';

  // Dynamic presence status calculation using unified hook
  const targetUser = offer.profiles || {
    last_seen: offer.seller_last_seen,
    is_online: offer.seller_is_online
  };
  const presence = usePresenceStatus(targetUser, 15000);
  const isOnline = presence.isOnline;

  const formatCurrency = (val: number, currencySymbol: string) => {
    try {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currencySymbol,
        maximumFractionDigits: 2,
      }).format(val);
    } catch {
      return `${val.toLocaleString()} ${currencySymbol}`;
    }
  };

  const tradeCount = offer.completed_trades_count ?? offer.profiles?.completed_trades_count ?? 0;

  const minLimit = Number(offer.min_limit || 0);
  const maxLimit = Number(offer.max_limit || 0);
  const price = Number(offer.price || 0);
  const asset = (offer.asset_symbol || 'USDT').toUpperCase();

  const availCrypto = Number(
    (offer as any).available_crypto ?? 
    (offer as any).availableCrypto ?? 
    (offer.profiles as any)?.cryptoBalances?.[asset] ?? 
    (offer.profiles as any)?.[`${asset.toLowerCase()}_balance`] ?? 
    -1
  );

  let effectiveMaxLimit = maxLimit;
  if (isSellerAd && availCrypto >= 0 && price > 0) {
    const availFiat = availCrypto * price;
    if (availFiat > 0) {
      effectiveMaxLimit = maxLimit > 0 ? Math.min(maxLimit, availFiat) : availFiat;
    }
  }

  return (
    <div className="p-5 border rounded-2xl bg-card flex flex-col md:flex-row justify-between items-start md:items-center gap-4 hover:shadow-sm transition-shadow">
      <div className="space-y-2">
        {/* User Handle & Real-time Indicator */}
        <div className="flex items-center gap-2">
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              isOnline ? 'bg-emerald-500' : 'bg-gray-400'
            }`}
          />
          <Link
            href={`/users/${username}`}
            className="font-bold text-foreground hover:underline text-base"
          >
            @{username}
          </Link>
        </div>

        {/* Dynamic Trade Stats and Status */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span>{tradeCount} Trades</span>
          <span>•</span>
          <span
            className={`px-2 py-0.5 rounded font-semibold text-xs ${
              isOnline
                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            {presence.label}
          </span>
        </div>

        {/* Dynamic Payment Methods */}
        {offer.payment_methods && offer.payment_methods.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {offer.payment_methods.map((method, idx) => (
              <span
                key={idx}
                className="text-xs px-2.5 py-1 rounded-md bg-muted font-medium text-foreground"
              >
                {method}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Pricing & Call to Action */}
      <div className="text-right flex md:flex-col justify-between w-full md:w-auto items-center md:items-end gap-2">
        <div>
          <div className="text-xs text-muted-foreground uppercase font-medium">Price</div>
          <div className="text-xl font-extrabold text-foreground">
            {formatCurrency(Number(offer.price), offer.fiat_symbol)}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Limits: {formatCurrency(minLimit, offer.fiat_symbol)} -{' '}
            {formatCurrency(effectiveMaxLimit, offer.fiat_symbol)}
          </div>
        </div>

        <Link
          href={`/ad/${offer.id}`}
          className={`px-5 py-2 rounded-xl font-bold text-sm transition-colors text-white ${
            isSellerAd
              ? 'bg-emerald-600 hover:bg-emerald-700'
              : 'bg-red-500 hover:bg-red-600'
          }`}
        >
          {isSellerAd ? `Buy ${offer.asset_symbol}` : `Sell ${offer.asset_symbol}`}
        </Link>
      </div>
    </div>
  );
}
