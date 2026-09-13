'use client';

import React from 'react';
import Link from 'next/link';
import UserAvatar from '@/components/common/UserAvatar';
import { getPresenceStatus, formatJoinedDate, usePresenceStatus, resolveUserLastSeen } from '@/lib/presence';

export interface AdData {
  id?: string;
  min_limit?: number;
  max_limit?: number;
  minLimit?: number;
  maxLimit?: number;
  price?: number;
  unit_price?: number;
  customUnitPrice?: number;
  fiat_currency?: string;
  fiatCurrency?: string;
  crypto_symbol?: string;
  cryptoSymbol?: string;
  crypto?: string;
  asset?: string;
  coin?: string;
  payment_method?: string;
  paymentMethods?: string[];
  payment_window?: number;
  advertiser_balance_usd?: number;
  advertiserBalanceUSD?: number;
  user?: any;
  profiles?: any;
  last_seen?: string;
  created_at?: string;
}

export function AdCard({ ad }: { ad: AdData }) {
  // 1. User & Presence Data Extraction
  const user = ad?.profiles || ad?.user || ad || {};
  const userLastSeen = resolveUserLastSeen(user) || ad?.last_seen;
  const presence = usePresenceStatus(userLastSeen, 15000);
  const joinedText = formatJoinedDate(user?.created_at || user?.createdAt || ad?.created_at);
  const username = user?.username || ad?.user?.username || 'trader';
  const avatarUrl = user?.avatar_url || user?.photoURL || ad?.user?.avatar_url;

  // 2. Dynamic Asset & Currency Extraction (Ensures LTC is not defaulted to BTC)
  const fiatCurrency = (
    ad?.fiat_currency || 
    ad?.fiatCurrency || 
    'PKR'
  ).toUpperCase();
  
  const cryptoSymbol = (
    ad?.crypto_symbol || 
    ad?.cryptoSymbol || 
    ad?.crypto || 
    ad?.asset || 
    ad?.coin || 
    'LTC'
  ).toUpperCase();
  
  const unitPrice = ad?.price || ad?.unit_price || ad?.customUnitPrice || 0;

  // 3. Limits Extraction
  const minLimit = ad?.min_limit ?? ad?.minLimit ?? 0;
  const maxLimit = ad?.max_limit ?? ad?.maxLimit ?? 0;
  const balance = ad?.advertiser_balance_usd ?? ad?.advertiserBalanceUSD ?? maxLimit;
  
  const effectiveMaxLimit = Math.min(maxLimit, balance);
  const isAvailable = balance >= minLimit;

  // 4. Payment Method
  const paymentMethod = ad?.payment_method || (ad?.paymentMethods ? ad.paymentMethods.join(', ') : 'Bank Transfer');

  return (
    <div className="p-4 sm:p-5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm transition-all hover:shadow-md space-y-4">
      {/* Header: User Info & Online Status */}
      <div className="flex items-center justify-between flex-wrap gap-2 pb-3 border-b border-neutral-100 dark:border-neutral-800">
        <div className="flex items-center space-x-2">
          <UserAvatar avatarUrl={avatarUrl} username={username} size="sm" />
          <Link href={`/users/${username}`} className="font-semibold text-sm hover:underline text-neutral-900 dark:text-neutral-100">
            @{username}
          </Link>
        </div>
        
        <div className="flex items-center space-x-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          <span
            className={`w-2 h-2 rounded-full ${
              presence.isOnline ? 'bg-green-500' : 'bg-neutral-400'
            }`}
          />
          <span className={presence.isOnline ? 'text-green-600 dark:text-green-400 font-medium' : ''}>
            {presence.label}
          </span>
          <span>•</span>
          <span>{joinedText}</span>
        </div>
      </div>

      {/* Body: Price, Limits, and Payment Info */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Unit Price */}
        <div className="space-y-1">
          <div className="text-xs text-neutral-500 dark:text-neutral-400 uppercase font-semibold">Unit Price</div>
          <div className="text-lg font-extrabold font-mono text-neutral-900 dark:text-neutral-100">
            {unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
            <span className="text-xs font-normal text-neutral-500">{fiatCurrency} / {cryptoSymbol}</span>
          </div>
        </div>

        {/* Available Limits */}
        <div className="space-y-1 md:text-right">
          <div className="text-xs text-neutral-500 dark:text-neutral-400 font-medium">Order Limits</div>
          {isAvailable ? (
            <div className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
              {minLimit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} – {effectiveMaxLimit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
              <span className="text-xs font-normal text-neutral-500">{fiatCurrency}</span>
            </div>
          ) : (
            <div className="text-xs font-semibold text-red-500">
              Insufficient Balance
            </div>
          )}
        </div>

        {/* Action & Payment Method */}
        <div className="flex items-center justify-between md:justify-end gap-3 pt-2 md:pt-0">
          <span className="text-xs font-medium px-2.5 py-1 rounded bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300">
            {paymentMethod}
          </span>
          <Link
            href={`/trade/${ad?.id || ''}`}
            className="px-4 py-2 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 dark:bg-red-500 dark:hover:bg-red-600 rounded-lg transition-colors"
          >
            Sell {cryptoSymbol}
          </Link>
        </div>
      </div>
    </div>
  );
}

export default AdCard;