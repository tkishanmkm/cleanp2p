'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { formatOnlineStatus, formatJoinedDate } from '@/utils/p2p-helpers';
import { ThumbsUp, ThumbsDown, Clock, ShieldCheck, User, AlertCircle, RefreshCw } from 'lucide-react';

interface AdData {
  id: string;
  user_id: string;
  type?: string;
  ad_type?: string;
  asset?: string;
  crypto?: string;
  coin?: string;
  fiat?: string;
  fiat_currency?: string;
  price: number;
  min_limit?: number;
  min_amount?: number;
  max_limit?: number;
  max_amount?: number;
  payment_window?: number;
  payment_methods?: string[];
  terms?: string;
  tags?: string[];
  user?: {
    id?: string;
    username?: string;
    full_name?: string;
    avatar_url?: string | null;
    created_at?: string;
    last_seen_at?: string | null;
    completed_trades?: number;
    positive_feedback?: number;
    negative_feedback?: number;
    avg_release_time?: string;
  };
}

export default function AdDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();

  const adId = typeof params?.adId === 'string' ? params.adId : Array.isArray(params?.adId) ? params.adId[0] : '';

  const [ad, setAd] = useState<AdData | null>(null);
  const [fiatAmount, setFiatAmount] = useState<string>('');
  const [cryptoAmount, setCryptoAmount] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    async function fetchAdDetails() {
      if (!adId) {
        setErrorText('No advertisement ID provided.');
        setLoading(false);
        return;
      }

      setLoading(true);

      const { data, error } = await supabase
        .from('p2p_ads')
        .select('*, user:profiles(*)')
        .eq('id', adId)
        .maybeSingle();

      if (error) {
        // Direct fallback query if relational join fails
        const directAd = await supabase.from('p2p_ads').select('*').eq('id', adId).maybeSingle();
        if (directAd.data) {
          const profile = await supabase.from('profiles').select('*').eq('id', directAd.data.user_id).maybeSingle();
          const adObj = directAd.data as AdData;
          if (profile.data) adObj.user = profile.data;
          setAd(adObj);
        } else {
          setErrorText(error.message);
        }
      } else if (!data) {
        setErrorText(`Advertisement "${adId}" was not found.`);
      } else {
        setAd(data as AdData);
      }

      setLoading(false);
    }

    fetchAdDetails();
  }, [adId]);

  // Calculate using ad.price (User's specified fixed or margin price)
  const handleFiatChange = (val: string) => {
    setFiatAmount(val);
    if (!ad || !val || isNaN(Number(val)) || ad.price <= 0) {
      setCryptoAmount('');
      return;
    }
    setCryptoAmount((parseFloat(val) / ad.price).toFixed(8));
  };

  const handleCryptoChange = (val: string) => {
    setCryptoAmount(val);
    if (!ad || !val || isNaN(Number(val))) {
      setFiatAmount('');
      return;
    }
    setFiatAmount((parseFloat(val) * ad.price).toFixed(2));
  };

  const handleInitiateTrade = async () => {
    if (!ad) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/p2p/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adId: ad.id,
          fiatAmount: parseFloat(fiatAmount),
          cryptoAmount: parseFloat(cryptoAmount),
        }),
      });

      const data = await res.json();
      if (res.ok && data.tradeId) {
        router.push(`/trade/${data.tradeId}`);
      } else {
        alert(data.error || 'Failed to initiate escrow.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400 font-sans text-sm">
        <RefreshCw className="w-5 h-5 animate-spin text-blue-500" />
        <span>Loading offer details...</span>
      </div>
    );
  }

  if (errorText || !ad) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-4 text-center">
        <AlertCircle className="w-10 h-10 text-red-500 mb-2" />
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">Advertisement unavailable</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mt-1">{errorText}</p>
        <button
          onClick={() => router.push('/p2p')}
          className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700"
        >
          Return to P2P Marketplace
        </button>
      </div>
    );
  }

  const rawType = (ad.type || ad.ad_type || 'BUY').toUpperCase();
  const assetSymbol = ad.crypto || ad.coin || ad.asset || 'BTC';
  const fiatSymbol = ad.fiat || ad.fiat_currency || 'USD';
  const minLimit = ad.min_limit ?? ad.min_amount ?? 100;
  const maxLimit = ad.max_limit ?? ad.max_amount ?? 5000;
  const paymentWindow = ad.payment_window ?? 30;
  const paymentMethodStr = ad.payment_methods?.join(', ') || 'Bank Transfer';

  // STRICT RULE: Force Username over full_name everywhere
  const username = ad.user?.username || 'user';
  
  // GRAMMAR CORRECTION RULE:
  // If ad_type is SELL -> User is selling to merchant -> "Sell BTC to username"
  // If ad_type is BUY  -> User is buying from merchant -> "Buy BTC from username"
  const grammarTitle = rawType === 'SELL' 
    ? `Buy ${assetSymbol} from` 
    : `Sell ${assetSymbol} to`;

  const statusInfo = formatOnlineStatus(ad.user?.last_seen_at);
  const joinedText = formatJoinedDate(ad.user?.created_at);

  const hasTerms = Boolean(ad.terms && ad.terms.trim().length > 0);
  const hasTags = Boolean(ad.tags && ad.tags.length > 0);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        
        {/* Correct Grammar Header */}
        <div className="border-b border-gray-200 dark:border-gray-800 pb-4">
          <h1 className="text-xl sm:text-2xl font-bold">
            {grammarTitle} <span className="text-blue-600 dark:text-blue-400">{username}</span>
          </h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left Column: Merchant Details */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Merchant Info Box */}
            <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-4">
              <h2 className="text-xs uppercase font-bold text-gray-400 tracking-wider">Trader Info</h2>
              
              <div className="flex items-center gap-4">
                <div className="relative">
                  {ad.user?.avatar_url ? (
                    <img src={ad.user.avatar_url} alt={username} className="w-12 h-12 rounded-full object-cover" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-gray-600 dark:text-gray-300 font-bold">
                      <User className="w-6 h-6" />
                    </div>
                  )}
                  <span
                    className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-white dark:border-gray-800 ${
                      statusInfo.isOnline ? 'bg-green-500' : 'bg-gray-400'
                    }`}
                  />
                </div>

                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-lg">{username}</span>
                    <ShieldCheck className="w-4 h-4 text-green-500" />
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-2">
                    <span className={statusInfo.isOnline ? 'text-green-600 dark:text-green-400 font-medium' : ''}>
                      Trader status: {statusInfo.text}
                    </span>
                    <span>•</span>
                    <span>{joinedText}</span>
                  </div>
                </div>
              </div>

              {/* Exact Real Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-gray-100 dark:border-gray-700 text-sm">
                <div>
                  <span className="text-xs text-gray-400 block">Trades</span>
                  <span className="font-semibold">{ad.user?.completed_trades ?? 0}</span>
                </div>
                <div>
                  <span className="text-xs text-gray-400 block">Positive</span>
                  <span className="font-semibold text-green-600 dark:text-green-400 flex items-center gap-1">
                    <ThumbsUp className="w-4 h-4" /> {ad.user?.positive_feedback ?? 0}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-400 block">Negative</span>
                  <span className="font-semibold text-red-500 dark:text-red-400 flex items-center gap-1">
                    <ThumbsDown className="w-4 h-4" /> {ad.user?.negative_feedback ?? 0}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-400 block">Avg Release</span>
                  <span className="font-semibold">{ad.user?.avg_release_time || 'N/A'}</span>
                </div>
              </div>
            </div>

            {/* Ad Price and Settings (Using Exact Ad Price) */}
            <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-4">
              <h2 className="text-xs uppercase font-bold text-gray-400 tracking-wider">Ad Info</h2>
              
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-xs text-gray-400 block">Price</span>
                  <span className="text-xl font-extrabold text-blue-600 dark:text-blue-400">
                    {ad.price.toLocaleString()} {fiatSymbol} <span className="text-xs font-normal text-gray-500">/ {assetSymbol}</span>
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-400 block">Limits</span>
                  <span className="font-semibold">
                    {minLimit.toLocaleString()} - {maxLimit.toLocaleString()} {fiatSymbol}
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-400 block">Payment Window</span>
                  <span className="font-semibold flex items-center gap-1">
                    <Clock className="w-4 h-4 text-amber-500" /> {paymentWindow} minutes
                  </span>
                </div>
                <div>
                  <span className="text-xs text-gray-400 block">Payment Method</span>
                  <span className="font-semibold bg-gray-100 dark:bg-gray-700 px-2.5 py-1 rounded-md inline-block mt-0.5">
                    {paymentMethodStr}
                  </span>
                </div>
              </div>
            </div>

            {/* Conditional Tags */}
            {hasTags && (
              <div className="flex flex-wrap gap-2">
                {ad.tags!.map((tag, idx) => (
                  <span key={idx} className="bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300 border border-blue-200 dark:border-blue-800/50 text-xs px-3 py-1 rounded-full font-medium">
                    {tag}
                  </span>
                ))}
              </div>
            )}

            {/* Conditional Terms */}
            {hasTerms && (
              <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm space-y-2">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500" /> Offer Terms & Conditions
                </h2>
                <p className="text-sm whitespace-pre-line text-gray-600 dark:text-gray-300 leading-relaxed">
                  {ad.terms}
                </p>
              </div>
            )}

          </div>

          {/* Right Column: Calculator tied directly to Ad Price */}
          <div className="bg-white dark:bg-gray-800 p-5 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm h-fit space-y-5">
            <h2 className="text-base font-bold">Enter Trade Amount</h2>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 block mb-1">
                  I want to pay ({fiatSymbol})
                </label>
                <div className="relative">
                  <input
                    type="number"
                    placeholder={`Limit: ${minLimit} - ${maxLimit}`}
                    value={fiatAmount}
                    onChange={(e) => handleFiatChange(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none text-sm pr-14"
                  />
                  <span className="absolute right-3 top-2.5 text-xs font-bold text-gray-400">
                    {fiatSymbol}
                  </span>
                </div>
              </div>

              <div>
                <label className="text-xs font-semibold text-gray-500 dark:text-gray-400 block mb-1">
                  I will receive ({assetSymbol})
                </label>
                <div className="relative">
                  <input
                    type="number"
                    placeholder="0.00"
                    value={cryptoAmount}
                    onChange={(e) => handleCryptoChange(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-gray-300 dark:border-gray-600 bg-transparent focus:ring-2 focus:ring-blue-500 outline-none text-sm pr-14"
                  />
                  <span className="absolute right-3 top-2.5 text-xs font-bold text-gray-400">
                    {assetSymbol}
                  </span>
                </div>
              </div>
            </div>

            <button
              onClick={handleInitiateTrade}
              disabled={
                submitting ||
                !fiatAmount ||
                Number(fiatAmount) < minLimit ||
                Number(fiatAmount) > maxLimit
              }
              className={`w-full py-3 rounded-lg font-bold text-white transition-all ${
                rawType === 'SELL'
                  ? 'bg-red-600 hover:bg-red-700 disabled:bg-gray-300 dark:disabled:bg-gray-700'
                  : 'bg-green-600 hover:bg-green-700 disabled:bg-gray-300 dark:disabled:bg-gray-700'
              }`}
            >
              {submitting ? 'Initiating Trade...' : 'Initiate Trade'}
            </button>
          </div>

        </div>
      </div>
    </div>
  );
}
