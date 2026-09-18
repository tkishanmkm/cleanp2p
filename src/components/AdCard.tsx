'use client';

import React from 'react';
import { checkIsOnline, formatJoinedDate, getDisplayUsername } from '@/lib/utils/timeFormatter';

export interface Profile {
  id?: string;
  username?: string | null;
  avatar_url?: string | null;
  is_online?: boolean;
  last_seen?: string | null;
  created_at?: string | null;
}

export interface AdCardProps {
  ad: {
    id: string;
    type?: 'buy' | 'sell' | 'BUY' | 'SELL';
    trade_type?: 'buy' | 'sell' | 'BUY' | 'SELL';
    user_id?: string;
    crypto_currency?: string;
    asset_symbol?: string;
    asset?: string;
    fiat_currency?: string;
    fiat_symbol?: string;
    price: number;
    min_limit: number;
    max_limit: number;
    payment_method?: string;
    profiles?: Profile | Profile[] | null;
    user?: Profile | null;
    [key: string]: any;
  };
  onSelectAd?: (adId: string) => void;
}

export function AdCard({ ad, onSelectAd }: AdCardProps) {
  // 1. Unnest profile record safely
  const profile: Profile | null = Array.isArray(ad.profiles)
    ? ad.profiles[0]
    : ad.profiles || ad.user || null;

  // 2. Derive dynamic username without static hardcoded fallbacks
  const username = getDisplayUsername(ad);

  // 3. Compute live presence & joined date text
  const isOnline = checkIsOnline(profile?.last_seen, profile?.is_online);
  const joinedDateText = formatJoinedDate(profile?.created_at);

  const rawType = (ad.trade_type || ad.type || 'BUY').toUpperCase();
  const crypto = (ad.crypto_currency || ad.asset_symbol || ad.asset || 'USDT').toUpperCase();
  const fiat = (ad.fiat_currency || ad.fiat_symbol || 'USD').toUpperCase();
  const price = Number(ad.price || 0);

  const minLimit = Number(ad.min_limit ?? ad.min_amount ?? ad.minAmount ?? 0);
  const maxLimit = Number(ad.max_limit ?? ad.max_amount ?? ad.maxAmount ?? 0);

  // If advertiser is selling, cap max limit by available balance in fiat
  let effectiveMaxLimit = maxLimit;
  const availCrypto = Number(
    ad.available_crypto ?? 
    ad.availableCrypto ?? 
    (profile as any)?.cryptoBalances?.[crypto] ?? 
    (profile as any)?.[`${crypto.toLowerCase()}_balance`] ?? 
    (profile as any)?.available_balance ?? 
    -1
  );

  if (rawType === 'SELL' && availCrypto >= 0 && price > 0) {
    const availFiat = availCrypto * price;
    if (availFiat > 0) {
      effectiveMaxLimit = maxLimit > 0 ? Math.min(maxLimit, availFiat) : availFiat;
    }
  }

  return (
    <div id={`ad-card-${ad.id}`} className="border rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-all mb-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Avatar with Online/Offline Dot */}
          <div className="relative">
            <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center font-bold text-slate-700">
              {username.charAt(0).toUpperCase()}
            </div>
            <span
              className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white ${
                isOnline ? 'bg-emerald-500' : 'bg-slate-400'
              }`}
            />
          </div>

          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-slate-900">{username}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                isOnline ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-slate-100 text-slate-600'
              }`}>
                {isOnline ? 'Online' : 'Offline'}
              </span>
            </div>
            <p className="text-xs text-slate-500">{joinedDateText}</p>
          </div>
        </div>

        <button 
          id={`btn-select-ad-${ad.id}`}
          onClick={() => onSelectAd?.(ad.id)}
          className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-sm px-4 py-2 rounded-md transition-colors"
        >
          {rawType === 'BUY' ? 'Sell' : 'Buy'} {crypto}
        </button>
      </div>

      {/* Pricing & Limits */}
      <div className="flex items-center justify-between pt-3 mt-3 border-t border-slate-100 text-sm">
        <div>
          <span className="text-slate-500 block text-xs">Price</span>
          <span className="font-bold text-slate-900">{Number(ad.price).toLocaleString()} {fiat}</span>
        </div>
        <div className="text-right">
          <span className="text-slate-500 block text-xs">Limits</span>
          <span className="text-slate-700">{minLimit.toLocaleString()} - {effectiveMaxLimit.toLocaleString()} {fiat}</span>
        </div>
      </div>
    </div>
  );
}

export default AdCard;
