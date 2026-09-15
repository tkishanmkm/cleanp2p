'use client';

import React from 'react';
import Link from 'next/link';
import { ThumbsUp, ThumbsDown, User } from 'lucide-react';
import { getPublicHandle } from '@/utils/userPrivacy';
import { getPresenceStatus, formatJoinedDate } from '@/lib/presence';
import { MerchantBadge } from '@/components/merchant/merchant-badge';

export interface SellerStatsProps {
  avgReleaseTime?: number | string | null;
  avgPayTime?: number | string | null;
  completionRate?: number | string | null;
}

export function SellerTradeMetrics({ stats }: { stats?: SellerStatsProps }) {
  // Convert any string, null, or undefined metric into a safe primitive number
  const safeReleaseTime = Number(stats?.avgReleaseTime ?? stats?.avgPayTime ?? 0) || 0;
  const safeCompletionRate = Number(stats?.completionRate ?? 0) || 0;

  return (
    <div className="flex items-center gap-4 text-xs text-gray-600 dark:text-gray-300">
      <div>
        <span className="font-semibold text-gray-900 dark:text-gray-100">
          {safeCompletionRate.toFixed(1)}%
        </span>{' '}
        Completion
      </div>
      <div>
        <span className="font-semibold text-gray-900 dark:text-gray-100">
          {safeReleaseTime.toFixed(2)} min
        </span>{' '}
        Avg. Release
      </div>
    </div>
  );
}

export interface AdCardProps {
  ad: {
    id: string;
    type?: 'BUY' | 'SELL' | string;
    ad_type?: string;
    asset?: string | null;
    fiat_currency?: string | null;
    price?: number | null;
    min_limit?: number | null;
    max_limit?: number | null;
    payment_methods?: string[] | string | null;
    seller_last_seen?: string | null;
    last_seen?: string | null;
    user?: {
      username?: string | null;
      avatar_url?: string | null;
      completed_trades?: number;
      positive_feedback?: number;
      negative_feedback?: number;
      is_online?: boolean;
      last_seen?: string | null;
      seller_last_seen?: string | null;
      merchant_tier?: string | null;
    } | null;
    profiles?: {
      id?: string;
      username?: string | null;
      avatar_url?: string | null;
      is_online?: boolean | null;
      last_seen?: string | null;
      seller_last_seen?: string | null;
      merchant_tier?: string | null;
      completed_trades?: number;
      positive_feedback?: number;
      negative_feedback?: number;
    } | null;
    [key: string]: any;
  };
}

export default function AdCard({ ad }: AdCardProps) {
  // Always use standard @username handle over full name or random numbers
  const traderProfile = ad.user || ad.profiles;
  const displayUsername = getPublicHandle(traderProfile || ad);
  
  // Presence calculation using seller_last_seen with 120-second online threshold
  const lastSeen = ad.seller_last_seen || ad.last_seen || ad.user?.seller_last_seen || ad.user?.last_seen || ad.profiles?.seller_last_seen || ad.profiles?.last_seen || null;
  const createdAt = ad.user?.created_at || ad.user?.createdAt || ad.profiles?.created_at || ad.profiles?.createdAt || ad.created_at;
  const presence = getPresenceStatus(lastSeen);
  const joinedText = formatJoinedDate(createdAt);

  // Asset and fiat defaults: BTC and USD
  const assetSymbol = (ad.asset || (ad as any).crypto || (ad as any).coin || 'BTC').toUpperCase();
  const fiatSymbol = (ad.fiat_currency || (ad as any).fiat || (ad as any).fiatCurrency || 'USD').toUpperCase();
  const adType = (ad.type || ad.ad_type || (ad as any).adType || 'SELL').toUpperCase();

  // Price and limits handling
  const priceVal = Number(ad.price ?? (ad as any).unit_price ?? 0);
  const minLimitVal = Number(ad.min_limit ?? (ad as any).min_amount ?? 0);
  const maxLimitVal = Number(ad.max_limit ?? (ad as any).max_amount ?? 0);

  // Parse payment_methods list
  const rawMethods = ad.payment_methods ?? (ad as any).paymentMethods;
  const methodsList: string[] = (() => {
    if (Array.isArray(rawMethods)) return rawMethods.map(String);
    if (typeof rawMethods === 'string') {
      try {
        const parsed = JSON.parse(rawMethods);
        if (Array.isArray(parsed)) return parsed.map(String);
      } catch {}
      return rawMethods.split(',').map((s: string) => s.trim()).filter(Boolean);
    }
    return ['Bank Transfer'];
  })();

  const avatarUrl = ad.user?.avatar_url || ad.profiles?.avatar_url || null;
  const completedTrades = Number(ad.user?.completed_trades ?? ad.profiles?.completed_trades ?? (ad as any).completed_trades ?? 0);
  const positiveFeedback = Number(ad.user?.positive_feedback ?? ad.profiles?.positive_feedback ?? (ad as any).positive_feedback ?? 0);
  const negativeFeedback = Number(ad.user?.negative_feedback ?? ad.profiles?.negative_feedback ?? (ad as any).negative_feedback ?? 0);
  const merchantTier = traderProfile?.merchant_tier || (ad as any)?.merchant_tier || null;

  return (
    <div className="bg-white dark:bg-gray-800 p-4 sm:p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors">
      {/* Trader Profile Snapshot */}
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={displayUsername}
              className="w-10 h-10 rounded-full object-cover border border-border"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 font-semibold">
              <User className="w-5 h-5" />
            </div>
          )}
          <span
            className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-gray-800 ${
              presence.isOnline ? 'bg-green-500' : 'bg-gray-400'
            }`}
          />
        </div>

        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="font-bold text-gray-900 dark:text-gray-100 text-base">
              {displayUsername}
            </h3>
            {merchantTier && <MerchantBadge tier={merchantTier} size="sm" />}
          </div>
          <div className="flex items-center space-x-1.5 text-xs text-neutral-500 dark:text-neutral-400 mt-1">
            {/* Online / Offline Dot */}
            <span
              className={`w-2 h-2 rounded-full ${
                presence.isOnline ? 'bg-green-500' : 'bg-neutral-400'
              }`}
            />
            {/* Status Label (Online or "Seen Xm ago") */}
            <span className={presence.isOnline ? 'text-green-600 dark:text-green-400 font-medium' : ''}>
              {presence.label}
            </span>

            <span>•</span>

            {/* Dynamic Joined Date ("Joined 3 days ago", "Joined 1 month ago", etc.) */}
            <span>{joinedText}</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-1">
            <span>{completedTrades} Trades</span>
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400 font-medium">
              <ThumbsUp className="w-3.5 h-3.5" /> {positiveFeedback}
            </span>
            <span className="flex items-center gap-1 text-red-500 dark:text-red-400 font-medium">
              <ThumbsDown className="w-3.5 h-3.5" /> {negativeFeedback}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {methodsList.map((m, idx) => (
              <span
                key={idx}
                className="inline-block bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs px-2.5 py-0.5 rounded-md font-medium"
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Pricing & Limits */}
      <div className="flex flex-row md:flex-col justify-between md:items-end border-t md:border-t-0 pt-3 md:pt-0 border-gray-100 dark:border-gray-700">
        <div>
          <span className="text-xs text-gray-400 uppercase font-semibold block md:text-right">Price</span>
          <div className="text-lg font-extrabold text-gray-900 dark:text-gray-100">
            {priceVal.toLocaleString()} <span className="text-xs font-normal text-gray-500">{fiatSymbol}</span>
          </div>
        </div>
        <div className="text-right">
          <span className="text-xs text-gray-400 block">Limits</span>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
            {minLimitVal.toLocaleString()} - {maxLimitVal.toLocaleString()} {fiatSymbol}
          </span>
        </div>
      </div>

      {/* Route to /ad/[adId] */}
      <div className="pt-2 md:pt-0">
        <Link
          href={`/ad/${ad.id}`}
          className={`w-full md:w-auto px-6 py-2.5 rounded-lg font-bold text-white text-sm flex items-center justify-center transition-all ${
            adType === 'SELL'
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {adType === 'SELL' ? `Sell ${assetSymbol}` : `Buy ${assetSymbol}`}
        </Link>
      </div>
    </div>
  );
}

export { AdCard };
