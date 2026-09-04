'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { formatMemberDuration, isUserOnline } from '@/lib/utils/formatters';
import { supabase } from '@/lib/supabase/client';

interface AdDetailsProps {
  params: { adId: string };
}

export default function AdDetailsPage({ params }: AdDetailsProps) {
  const router = useRouter();
  const [ad, setAd] = useState<any>(null);
  const [calcDirection, setCalcDirection] = useState<'FIAT_TO_COIN' | 'COIN_TO_FIAT'>('FIAT_TO_COIN');
  const [fiatAmount, setFiatAmount] = useState<string>('500');
  const [coinAmount, setCoinAmount] = useState<string>('0');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadAd() {
      let resolvedAd: any = null;

      try {
        // Try fetching real ad from Supabase
        const { data: realAd } = await supabase
          .from('ads')
          .select(`
            *,
            profiles (
              id,
              username,
              avatar_url,
              created_at,
              last_active,
              last_seen_at,
              completed_trades,
              positive_feedback,
              negative_feedback,
              avg_payment_minutes,
              avg_release_minutes
            )
          `)
          .eq('id', params.adId)
          .maybeSingle();

        if (realAd) {
          const profile = Array.isArray(realAd.profiles) ? realAd.profiles[0] : realAd.profiles;
          const posCount = profile?.positive_feedback || 0;
          const negCount = profile?.negative_feedback || 0;
          const totalFb = posCount + negCount;
          const posPct = totalFb > 0 ? ((posCount / totalFb) * 100).toFixed(1) + '%' : '100.0%';
          const negPct = totalFb > 0 ? ((negCount / totalFb) * 100).toFixed(1) + '%' : '0.0%';

          resolvedAd = {
            id: realAd.id,
            type: realAd.type || 'SELL',
            cryptoCurrency: realAd.asset_symbol || realAd.crypto_currency || 'USDT',
            fiatCurrency: realAd.fiat_symbol || realAd.fiat_currency || 'USD',
            price: Number(realAd.price) || 1,
            minLimit: Number(realAd.min_limit) || 10,
            maxLimit: Number(realAd.max_limit) || 5000,
            availableBalance: Number(realAd.total_amount || realAd.available_balance || 500),
            paymentMethods: Array.isArray(realAd.payment_methods) ? realAd.payment_methods : ['Bank Transfer'],
            terms: realAd.terms || 'Fast release.',
            advertiser: {
              id: profile?.id || 'usr_1',
              username: `@${(profile?.username || 'trader').replace(/^@/, '')}`,
              avatarUrl: profile?.avatar_url || '',
              lastSeenAt: profile?.last_seen_at || profile?.last_active || new Date().toISOString(),
              createdAt: profile?.created_at || '2025-01-01T00:00:00Z',
              positiveFeedbackPct: posPct,
              negativeFeedbackPct: negPct,
              avgPaymentTime: `${profile?.avg_payment_minutes || 4} min`,
              avgReleaseTime: `${profile?.avg_release_minutes || 2} min`,
              completedTrades: profile?.completed_trades || 0,
            },
          };
        }
      } catch (err) {
        console.warn('Could not query real ad, falling back to mock:', err);
      }

      if (!resolvedAd) {
        // Mock fallback as specified
        resolvedAd = {
          id: params.adId,
          type: 'SELL',
          cryptoCurrency: 'BTC',
          fiatCurrency: 'USD',
          price: 100000, // 1 BTC = $100,000
          minLimit: 50,
          maxLimit: 5000,
          availableBalance: 0.5,
          paymentMethods: ['Zelle', 'Bank Transfer'],
          terms: 'Fast release. Please provide receipt.',
          advertiser: {
            id: 'usr_123',
            username: '@adamdam',
            avatarUrl: '',
            lastSeenAt: new Date().toISOString(),
            createdAt: '2025-02-01T00:00:00Z',
            positiveFeedbackPct: '98.5%',
            negativeFeedbackPct: '1.5%',
            avgPaymentTime: '4 min',
            avgReleaseTime: '2 min',
            completedTrades: 245,
          },
        };
      }

      setAd(resolvedAd);
      const val = 500;
      const calculated = val / resolvedAd.price;
      setCoinAmount(calculated.toFixed(6));
      if (val < resolvedAd.minLimit) {
        setError(`Minimum limit is $${resolvedAd.minLimit}`);
      } else if (val > resolvedAd.maxLimit) {
        setError(`Maximum limit is $${resolvedAd.maxLimit}`);
      } else {
        setError(null);
      }
    }

    loadAd();
  }, [params.adId]);

  const calculateCrypto = (fiat: string, price: number) => {
    const val = parseFloat(fiat) || 0;
    const calculated = val / price;
    setCoinAmount(calculated.toFixed(6));
    validateLimits(val, ad?.minLimit, ad?.maxLimit);
  };

  const calculateFiat = (coin: string, price: number) => {
    const val = parseFloat(coin) || 0;
    const calculated = val * price;
    setFiatAmount(calculated.toFixed(2));
    validateLimits(calculated, ad?.minLimit, ad?.maxLimit);
  };

  const validateLimits = (fiat: number, min?: number, max?: number) => {
    if (min !== undefined && fiat < min) {
      setError(`Minimum limit is $${min}`);
    } else if (max !== undefined && fiat > max) {
      setError(`Maximum limit is $${max}`);
    } else {
      setError(null);
    }
  };

  const handleFiatChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setFiatAmount(val);
    if (ad) calculateCrypto(val, ad.price);
  };

  const handleCoinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCoinAmount(val);
    if (ad) calculateFiat(val, ad.price);
  };

  const toggleDirection = () => {
    setCalcDirection((prev) =>
      prev === 'FIAT_TO_COIN' ? 'COIN_TO_FIAT' : 'FIAT_TO_COIN'
    );
  };

  const handleInitiateTrade = () => {
    if (error || !ad) return;
    router.push(`/trade/initiate/${ad.id}?amount=${fiatAmount}`);
  };

  if (!ad) return <div className="p-8 text-center text-gray-500">Loading ad details...</div>;

  const online = isUserOnline(ad.advertiser.lastSeenAt);

  return (
    <div className="max-w-6xl mx-auto p-4 md:p-8 space-y-6">
      <Link
        href="/buy"
        className="inline-flex items-center text-sm font-medium text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-1.5" />
        Back to Marketplace
      </Link>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Ad Spec & Trade Calculator */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="flex justify-between items-center mb-4">
              <span className="text-sm font-semibold text-blue-600 bg-blue-50 dark:bg-blue-900/40 px-3 py-1 rounded-full">
                {ad.type} {ad.cryptoCurrency}
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                Ad ID: {ad.id}
              </span>
            </div>

            <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white mb-2">
              {ad.price.toLocaleString()} <span className="text-lg font-normal">{ad.fiatCurrency}/{ad.cryptoCurrency}</span>
            </h1>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 py-4 border-y border-gray-100 dark:border-gray-700 text-sm">
              <div>
                <p className="text-gray-500 dark:text-gray-400">Available</p>
                <p className="font-semibold text-gray-800 dark:text-gray-200">{ad.availableBalance} {ad.cryptoCurrency}</p>
              </div>
              <div>
                <p className="text-gray-500 dark:text-gray-400">Limit</p>
                <p className="font-semibold text-gray-800 dark:text-gray-200">${ad.minLimit} - ${ad.maxLimit}</p>
              </div>
              <div>
                <p className="text-gray-500 dark:text-gray-400">Payment Window</p>
                <p className="font-semibold text-gray-800 dark:text-gray-200">15 mins</p>
              </div>
            </div>

            {/* Calculator Section */}
            <div className="mt-6 space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                  Trade Amount Calculation ({calcDirection === 'FIAT_TO_COIN' ? `${ad.fiatCurrency} ➔ ${ad.cryptoCurrency}` : `${ad.cryptoCurrency} ➔ ${ad.fiatCurrency}`})
                </label>
                <button
                  type="button"
                  onClick={toggleDirection}
                  className="text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 px-3 py-1 rounded-md text-gray-700 dark:text-gray-200 transition cursor-pointer"
                >
                  ⇄ Switch Direction
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <span className="text-xs text-gray-500 mb-1 block">Pay ({ad.fiatCurrency})</span>
                  <input
                    type="number"
                    value={fiatAmount}
                    onChange={handleFiatChange}
                    disabled={calcDirection === 'COIN_TO_FIAT'}
                    className="w-full p-3 border rounded-lg bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white disabled:opacity-60"
                  />
                </div>

                <div>
                  <span className="text-xs text-gray-500 mb-1 block">Receive ({ad.cryptoCurrency})</span>
                  <input
                    type="number"
                    value={coinAmount}
                    onChange={handleCoinChange}
                    disabled={calcDirection === 'FIAT_TO_COIN'}
                    className="w-full p-3 border rounded-lg bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white disabled:opacity-60"
                  />
                </div>
              </div>

              {error && <p className="text-sm text-red-500 font-medium">{error}</p>}

              <button
                type="button"
                onClick={handleInitiateTrade}
                disabled={!!error}
                className="w-full py-3.5 bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg shadow disabled:opacity-50 transition cursor-pointer"
              >
                Initiate Trade
              </button>
            </div>
          </div>
        </div>

        {/* Advertiser Card Component */}
        <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm h-fit space-y-6">
          <div className="flex items-center space-x-4">
            <div className="relative w-12 h-12 rounded-full overflow-hidden bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
              {ad.advertiser.avatarUrl ? (
                <Image
                  src={ad.advertiser.avatarUrl}
                  alt={ad.advertiser.username}
                  fill
                  className="object-cover"
                  unoptimized
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center font-bold text-gray-600 dark:text-gray-300">
                  {ad.advertiser.username.replace('@', '').charAt(0).toUpperCase() || 'U'}
                </span>
              )}
            </div>
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-white">{ad.advertiser.username}</h3>
              <div className="flex items-center space-x-2 text-xs">
                <span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-green-500' : 'bg-gray-400'}`} />
                <span className="text-gray-600 dark:text-gray-400">{online ? 'Online' : 'Offline'}</span>
                <span className="text-gray-300 dark:text-gray-600">•</span>
                <span className="text-gray-500 dark:text-gray-400">{formatMemberDuration(ad.advertiser.createdAt)}</span>
              </div>
            </div>
          </div>

          <div className="space-y-3 text-sm pt-4 border-t border-gray-100 dark:border-gray-700">
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Positive Feedback</span>
              <span className="font-semibold text-green-600">{ad.advertiser.positiveFeedbackPct}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Negative Feedback</span>
              <span className="font-semibold text-red-500">{ad.advertiser.negativeFeedbackPct}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Avg. Payment Time</span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">{ad.advertiser.avgPaymentTime}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Avg. Release Time</span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">{ad.advertiser.avgReleaseTime}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500 dark:text-gray-400">Completed Trades</span>
              <span className="font-semibold text-gray-800 dark:text-gray-200">{ad.advertiser.completedTrades}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
