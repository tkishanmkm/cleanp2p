'use client';

import Link from 'next/link';
import { ThumbsUp, ThumbsDown, User } from 'lucide-react';

export interface AdCardProps {
  ad: {
    id: string;
    type: 'BUY' | 'SELL';
    asset: string;
    fiat_currency: string;
    price: number;
    min_limit: number;
    max_limit: number;
    payment_method: string;
    user: {
      username: string;
      avatar_url?: string | null;
      completed_trades?: number;
      positive_feedback?: number;
      negative_feedback?: number;
      is_online?: boolean;
    };
  };
}

export default function AdCard({ ad }: AdCardProps) {
  // Always use username over full name
  const displayUsername = ad.user?.username || 'Trader';

  return (
    <div className="bg-white dark:bg-gray-800 p-4 sm:p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4 transition-colors">
      {/* Trader Profile Snapshot */}
      <div className="flex items-start gap-3">
        <div className="relative">
          {ad.user?.avatar_url ? (
            <img
              src={ad.user.avatar_url}
              alt={displayUsername}
              className="w-10 h-10 rounded-full object-cover"
            />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 font-semibold">
              <User className="w-5 h-5" />
            </div>
          )}
          <span
            className={`absolute bottom-0 right-0 w-3 h-3 rounded-full border-2 border-white dark:border-gray-800 ${
              ad.user?.is_online ? 'bg-green-500' : 'bg-gray-400'
            }`}
          />
        </div>

        <div>
          <h3 className="font-bold text-gray-900 dark:text-gray-100 text-base">
            {displayUsername}
          </h3>
          <div className="flex items-center gap-3 text-xs text-gray-500 dark:text-gray-400 mt-1">
            <span>{ad.user?.completed_trades || 0} Trades</span>
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400 font-medium">
              <ThumbsUp className="w-3.5 h-3.5" /> {ad.user?.positive_feedback || 0}
            </span>
            <span className="flex items-center gap-1 text-red-500 dark:text-red-400 font-medium">
              <ThumbsDown className="w-3.5 h-3.5" /> {ad.user?.negative_feedback || 0}
            </span>
          </div>
          <div className="mt-2">
            <span className="inline-block bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 text-xs px-2.5 py-0.5 rounded-md font-medium">
              {ad.payment_method}
            </span>
          </div>
        </div>
      </div>

      {/* Pricing & Limits */}
      <div className="flex flex-row md:flex-col justify-between md:items-end border-t md:border-t-0 pt-3 md:pt-0 border-gray-100 dark:border-gray-700">
        <div>
          <span className="text-xs text-gray-400 uppercase font-semibold block md:text-right">Price</span>
          <div className="text-lg font-extrabold text-gray-900 dark:text-gray-100">
            {ad.price.toLocaleString()} <span className="text-xs font-normal text-gray-500">{ad.fiat_currency}</span>
          </div>
        </div>
        <div className="text-right">
          <span className="text-xs text-gray-400 block">Limits</span>
          <span className="text-xs font-medium text-gray-700 dark:text-gray-300">
            {ad.min_limit.toLocaleString()} - {ad.max_limit.toLocaleString()} {ad.fiat_currency}
          </span>
        </div>
      </div>

      {/* Route to /ad/[adId] */}
      <div className="pt-2 md:pt-0">
        <Link
          href={`/ad/${ad.id}`}
          className={`w-full md:w-auto px-6 py-2.5 rounded-lg font-bold text-white text-sm flex items-center justify-center transition-all ${
            ad.type === 'SELL'
              ? 'bg-red-600 hover:bg-red-700'
              : 'bg-green-600 hover:bg-green-700'
          }`}
        >
          {ad.type === 'SELL' ? `Sell ${ad.asset}` : `Buy ${ad.asset}`}
        </Link>
      </div>
    </div>
  );
}

export { AdCard };
