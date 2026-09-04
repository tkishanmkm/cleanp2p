'use client';

import React, { useState, useEffect } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { formatMemberDuration, isUserOnline } from '@/lib/utils/formatters';
import { supabase } from '@/lib/supabase/client';

interface AdDetailsProps {
  params: Promise<{ adId: string }> | { adId: string };
}

export function TradeInitiateForm({ ad }: { ad: any }) {
  const router = useRouter();
  const [fiatAmount, setFiatAmount] = useState('500');
  const [cryptoAmount, setCryptoAmount] = useState('0.005');
  const [calcDirection, setCalcDirection] = useState<'FIAT_TO_COIN' | 'COIN_TO_FIAT'>('FIAT_TO_COIN');
  const [loading, setLoading] = useState(false);
  const [limitError, setLimitError] = useState<string | null>(null);
  const [fundError, setFundError] = useState<string | null>(null);

  useEffect(() => {
    if (ad?.price) {
      const initFiat = 500;
      const calculated = initFiat / ad.price;
      setFiatAmount(initFiat.toString());
      setCryptoAmount(calculated.toFixed(6));
      validateLimits(initFiat, ad.minLimit, ad.maxLimit);
    }
  }, [ad]);

  const validateLimits = (fiat: number, min?: number, max?: number) => {
    if (min !== undefined && fiat < min) {
      setLimitError(`Minimum limit is $${min.toLocaleString()}`);
    } else if (max !== undefined && fiat > max) {
      setLimitError(`Maximum limit is $${max.toLocaleString()}`);
    } else {
      setLimitError(null);
    }
  };

  const calculateCrypto = (fiat: string, price: number) => {
    const val = parseFloat(fiat) || 0;
    const calculated = price > 0 ? val / price : 0;
    setCryptoAmount(calculated.toFixed(6));
    validateLimits(val, ad?.minLimit, ad?.maxLimit);
  };

  const calculateFiat = (coin: string, price: number) => {
    const val = parseFloat(coin) || 0;
    const calculated = val * price;
    setFiatAmount(calculated.toFixed(2));
    validateLimits(calculated, ad?.minLimit, ad?.maxLimit);
  };

  const handleFiatChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setFiatAmount(val);
    setFundError(null);
    if (ad?.price) calculateCrypto(val, ad.price);
  };

  const handleCoinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setCryptoAmount(val);
    setFundError(null);
    if (ad?.price) calculateFiat(val, ad.price);
  };

  const toggleDirection = () => {
    setCalcDirection((prev) => (prev === 'FIAT_TO_COIN' ? 'COIN_TO_FIAT' : 'FIAT_TO_COIN'));
  };

  const handleTradeInitiate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (limitError) return;

    setLoading(true);
    setFundError(null);

    try {
      const res = await fetch('/api/trades/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adId: ad.id,
          fiatAmount: parseFloat(fiatAmount),
          cryptoAmount: parseFloat(cryptoAmount),
        }),
      });

      const result = await res.json();

      if (!res.ok) {
        if (result.code === 'INSUFFICIENT_FUNDS') {
          setFundError(result.error);
        } else {
          alert(result.error || 'Failed to initiate trade.');
        }
        return;
      }

      // Redirect to trade chat / escrow page
      router.push(`/trade/${result.tradeId}`);
    } catch (err) {
      alert('An error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">Initiate Trade</h3>
        <button
          type="button"
          onClick={toggleDirection}
          className="text-xs bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 px-3 py-1 rounded-md text-gray-700 dark:text-gray-200 transition cursor-pointer"
        >
          ⇄ Switch Direction
        </button>
      </div>

      <form onSubmit={handleTradeInitiate} className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-gray-500 mb-1 block font-medium">
              Pay ({ad.fiatCurrency || 'USD'})
            </label>
            <input
              type="number"
              step="any"
              value={fiatAmount}
              onChange={handleFiatChange}
              disabled={calcDirection === 'COIN_TO_FIAT'}
              className="w-full p-3 border rounded-lg bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white disabled:opacity-60 font-semibold focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>

          <div>
            <label className="text-xs text-gray-500 mb-1 block font-medium">
              Receive ({ad.cryptoCurrency || 'BTC'})
            </label>
            <input
              type="number"
              step="any"
              value={cryptoAmount}
              onChange={handleCoinChange}
              disabled={calcDirection === 'FIAT_TO_COIN'}
              className="w-full p-3 border rounded-lg bg-gray-50 dark:bg-gray-900 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-white disabled:opacity-60 font-semibold focus:ring-2 focus:ring-blue-500 outline-none"
            />
          </div>
        </div>

        {/* Limit validation warning */}
        {limitError && (
          <p className="text-sm text-red-500 font-medium">{limitError}</p>
        )}

        {/* Admin Fee Breakdown */}
        <div className="p-4 bg-gray-50 dark:bg-gray-900/60 rounded-lg border border-gray-100 dark:border-gray-700 space-y-2 text-xs">
          <div className="flex justify-between text-gray-500 dark:text-gray-400">
            <span>Platform Escrow Fee</span>
            <span className="font-semibold text-green-600 dark:text-green-400">0.00% (No Buyer Fee)</span>
          </div>
          <div className="flex justify-between text-gray-500 dark:text-gray-400">
            <span>Unit Price</span>
            <span className="font-medium text-gray-700 dark:text-gray-300">
              1 {ad.cryptoCurrency} = {Number(ad.price).toLocaleString()} {ad.fiatCurrency}
            </span>
          </div>
          <div className="flex justify-between text-gray-500 dark:text-gray-400 pt-1 border-t border-gray-200 dark:border-gray-700">
            <span>Locked in Escrow</span>
            <span className="font-bold text-gray-900 dark:text-white">
              {cryptoAmount} {ad.cryptoCurrency}
            </span>
          </div>
        </div>

        {/* Insufficient Funds Instruction Banner */}
        {fundError && (
          <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 rounded-lg text-amber-800 dark:text-amber-300 text-sm flex items-start gap-3">
            <span className="text-lg">⚠️</span>
            <div>
              <p className="font-semibold mb-1">Trade Cannot Be Initiated</p>
              <p>{fundError}</p>
            </div>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || !!limitError}
          className="w-full py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-bold rounded-lg shadow disabled:opacity-50 transition cursor-pointer"
        >
          {loading ? 'Verifying Escrow Availability...' : 'Start Trade'}
        </button>
      </form>
    </div>
  );
}

export default function AdDetailsPage({ params }: AdDetailsProps) {
  const unwrappedParams = (params && typeof (params as any).then === 'function')
    ? React.use(params as Promise<{ adId: string }>)
    : (params as { adId: string });
  const adId = unwrappedParams?.adId || '';

  const [ad, setAd] = useState<any>(null);

  useEffect(() => {
    async function loadAd() {
      if (!adId) return;
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
          .eq('id', adId)
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
          id: adId,
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
    }

    loadAd();
  }, [adId]);

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

            {/* Terms & Payment Methods */}
            <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 text-sm space-y-2">
              <div>
                <span className="text-gray-500 dark:text-gray-400 block mb-1 font-medium">Accepted Payment Methods:</span>
                <div className="flex flex-wrap gap-2">
                  {ad.paymentMethods?.map((pm: string, idx: number) => (
                    <span key={idx} className="bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2.5 py-1 rounded text-xs font-medium">
                      {pm}
                    </span>
                  ))}
                </div>
              </div>
              {ad.terms && (
                <div className="pt-2">
                  <span className="text-gray-500 dark:text-gray-400 block mb-1 font-medium">Advertiser Terms:</span>
                  <p className="text-xs text-gray-600 dark:text-gray-300 bg-gray-50 dark:bg-gray-900/50 p-3 rounded-lg border border-gray-100 dark:border-gray-700">
                    {ad.terms}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Real-time Trade Initiate Component */}
          <TradeInitiateForm ad={ad} />
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
