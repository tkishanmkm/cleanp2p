'use client';

import React from 'react';
import { getPublicHandle, isUserOnline, formatCurrencyValue } from '@/utils/userPrivacy';
import Link from 'next/link';

export default function OfferCard({ offer }: { offer: any }) {
  // Enforce profile_username over full_name or metadata
  const sellerHandle = getPublicHandle(offer.profiles?.username || 'pulsepost949');
  
  // Dynamic online state (active within last 5 minutes)
  const online = isUserOnline(offer.profiles?.is_online, offer.profiles?.last_seen);

  return (
    <div className="p-5 border rounded-2xl bg-card flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className={`w-2.5 h-2.5 rounded-full ${online ? 'bg-emerald-500' : 'bg-gray-400'}`} />
          <Link href={`/user/${sellerHandle.replace('@', '')}`} className="font-bold text-foreground hover:underline">
            {sellerHandle.replace('@', '')}
          </Link>
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span>0 Trades</span>
          <span className={`text-xs px-2 py-0.5 rounded ${online ? 'bg-emerald-500/10 text-emerald-500' : 'bg-muted text-muted-foreground'}`}>
            {online ? 'Online' : 'Offline'}
          </span>
        </div>

        <div className="flex flex-wrap gap-1.5 pt-1">
          {offer.payment_methods?.map((method: string, idx: number) => (
            <span key={idx} className="text-xs px-2.5 py-1 rounded-md bg-muted font-medium text-foreground">
              {method}
            </span>
          ))}
        </div>
      </div>

      <div className="text-right flex md:flex-col justify-between w-full md:w-auto items-center md:items-end gap-2">
        <div>
          <div className="text-xs text-muted-foreground uppercase font-medium">Price</div>
          <div className="text-xl font-extrabold text-foreground">
            {formatCurrencyValue(offer.price, offer.fiat_symbol)}
            <span className="text-xs text-emerald-500 ml-1.5 font-bold">+1.50%</span>
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            Limits: {formatCurrencyValue(offer.min_limit, offer.fiat_symbol)} - {formatCurrencyValue(offer.max_limit, offer.fiat_symbol)}
          </div>
        </div>

        <Link
          href={`/ad/${offer.id}`}
          className="bg-red-500 hover:bg-red-600 text-white px-5 py-2 rounded-xl font-bold text-sm transition-colors"
        >
          Sell BTC
        </Link>
      </div>
    </div>
  );
}
