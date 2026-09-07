'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/utils/supabase/client';
import { formatJoinedDate } from '@/utils/p2p-helpers';
import { usePrices } from '@/context/price-context';
import TraderStatusBadge from '@/components/TraderStatusBadge';
import { FlagIcon } from '@/components/ui/flag-icon';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
import { FIAT_CURRENCIES } from '@/lib/currencies';
import {
  ThumbsUp,
  ThumbsDown,
  Clock,
  ShieldCheck,
  User as UserIcon,
  AlertCircle,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ArrowRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

function getCurrencyCountryCode(currencyCode: string): string {
  const code = currencyCode?.toUpperCase() || 'USD';
  const customMap: Record<string, string> = {
    USD: 'us',
    EUR: 'eu',
    GBP: 'gb',
    INR: 'in',
    JPY: 'jp',
    AUD: 'au',
    CAD: 'ca',
    CHF: 'ch',
    CNY: 'cn',
    BRL: 'br',
    NGN: 'ng',
    KES: 'ke',
    ZAR: 'za',
    RUB: 'ru',
    TRY: 'tr',
    AED: 'ae',
    SAR: 'sa',
    SGD: 'sg',
    HKD: 'hk',
    NZD: 'nz',
    KRW: 'kr',
    THB: 'th',
    VND: 'vn',
    PHP: 'ph',
    IDR: 'id',
    MYR: 'my',
    PKR: 'pk',
    BDT: 'bd',
    EGP: 'eg',
    GHS: 'gh',
    COP: 'co',
    ARS: 'ar',
    CLP: 'cl',
    PEN: 'pe',
  };
  return customMap[code] || code.slice(0, 2).toLowerCase();
}

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
  price?: number | null;
  fixed_price?: number | null;
  fixed_rate?: number | null;
  margin?: number | null;
  rate_percent?: number | null;
  rate_type?: string;
  pricing_type?: string;
  is_fixed?: boolean;
  min_limit?: number;
  min_amount?: number;
  max_limit?: number;
  max_amount?: number;
  payment_window?: number;
  payment_methods?: string[] | string;
  terms?: string;
  tags?: string[];
  offer_label?: string;
  offerLabel?: string;
  user?: {
    id?: string;
    username?: string;
    full_name?: string;
    avatar_url?: string | null;
    photo_url?: string | null;
    created_at?: string;
    last_seen_at?: string | null;
    completed_trades?: number;
    positive_feedback?: number;
    negative_feedback?: number;
    avg_release_time?: string;
    avg_release_minutes?: number;
    avg_payment_minutes?: number;
    avg_pay_time?: string;
    btc_balance?: number;
    eth_balance?: number;
    usdt_balance?: number;
    ltc_balance?: number;
  };
}

export default function AdDetailPage() {
  const params = useParams();
  const router = useRouter();
  const supabase = createClient();
  const { prices, fiatRates } = usePrices();

  const adId = typeof params?.adId === 'string' ? params.adId : Array.isArray(params?.adId) ? params.adId[0] : '';

  const [ad, setAd] = useState<AdData | null>(null);
  const [fiatAmount, setFiatAmount] = useState<string>('');
  const [cryptoAmount, setCryptoAmount] = useState<string>('');
  const [creatorCryptoBalance, setCreatorCryptoBalance] = useState<number | null>(null);
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

      try {
        let foundAd: AdData | null = null;

        // 1. Fetch via server endpoint which bypasses RLS and populates creator profile and balance
        try {
          const apiRes = await fetch(`/api/p2p/ads/${adId}`);
          if (apiRes.ok) {
            const apiData = await apiRes.json();
            if (apiData.ad) {
              foundAd = apiData.ad;
              if (apiData.ad.creatorCryptoBalance !== undefined && apiData.ad.creatorCryptoBalance !== null) {
                setCreatorCryptoBalance(apiData.ad.creatorCryptoBalance);
              }
            }
          }
        } catch (apiErr) {
          console.warn('API /api/p2p/ads/[id] fetch failed, fallback to Supabase:', apiErr);
        }

        // 2. Direct fallback query if API didn't return
        if (!foundAd) {
          const { data, error } = await supabase
            .from('p2p_ads')
            .select('*, user:profiles(*)')
            .eq('id', adId)
            .maybeSingle();

          let adRecord = data as AdData | null;

          if (error || !adRecord) {
            const directAd = await supabase.from('p2p_ads').select('*').eq('id', adId).maybeSingle();
            if (directAd.data) {
              adRecord = directAd.data as AdData;
              const profile = await supabase.from('profiles').select('*').eq('id', directAd.data.user_id).maybeSingle();
              if (profile.data) adRecord.user = profile.data;
            } else {
              setErrorText(error?.message || `Advertisement "${adId}" was not found.`);
              setLoading(false);
              return;
            }
          }
          foundAd = adRecord;
        }

        if (foundAd) {
          setAd(foundAd);

          // Query live wallet balance if not provided
          const coin = (foundAd.crypto || foundAd.coin || foundAd.asset || 'USDT').toUpperCase();
          if (creatorCryptoBalance === null && foundAd.user_id) {
            try {
              const { data: wallet } = await supabase
                .from('user_wallets')
                .select('available_balance, balance, locked_balance')
                .eq('user_id', foundAd.user_id)
                .ilike('asset_symbol', coin)
                .maybeSingle();

              if (wallet) {
                const avail = Number(
                  wallet.available_balance ?? (Number(wallet.balance || 0) - Number(wallet.locked_balance || 0))
                );
                setCreatorCryptoBalance(Math.max(0, avail));
              } else if (foundAd.user) {
                // Fallback to profiles column balances
                const prof = foundAd.user;
                const colKey = `${coin.toLowerCase()}_balance` as keyof typeof prof;
                if (prof[colKey] !== undefined) {
                  setCreatorCryptoBalance(Number(prof[colKey] || 0));
                }
              }
            } catch (wErr) {
              console.warn('Wallet balance fetch error:', wErr);
            }
          }
        }
      } catch (err: any) {
        console.error('Error fetching ad details:', err);
        setErrorText(err.message || 'Failed to load advertisement.');
      } finally {
        setLoading(false);
      }
    }

    fetchAdDetails();
  }, [adId]);

  // Derived Values
  const rawType = (ad?.type || ad?.ad_type || 'BUY').toUpperCase();
  const assetSymbol = (ad?.crypto || ad?.coin || ad?.asset || 'BTC').toUpperCase();
  const fiatSymbol = (ad?.fiat || ad?.fiat_currency || 'USD').toUpperCase();
  const baseMinLimit = Number(ad?.min_limit ?? ad?.min_amount ?? 100);
  const baseMaxLimit = Number(ad?.max_limit ?? ad?.max_amount ?? 5000);
  const paymentWindow = Number(ad?.payment_window ?? 30);

  const fiatCurrencyConfig = useMemo(() => {
    return FIAT_CURRENCIES.find((c) => c.code.toUpperCase() === fiatSymbol) || {
      code: fiatSymbol,
      name: fiatSymbol,
      symbol: fiatSymbol === 'USD' ? '$' : fiatSymbol === 'EUR' ? '€' : fiatSymbol === 'GBP' ? '£' : '$',
    };
  }, [fiatSymbol]);

  const paymentMethodsList = useMemo(() => {
    if (!ad?.payment_methods) return ['Bank Transfer'];
    if (Array.isArray(ad.payment_methods)) return ad.payment_methods;
    if (typeof ad.payment_methods === 'string') {
      try {
        if (ad.payment_methods.startsWith('[')) return JSON.parse(ad.payment_methods);
      } catch {}
      return [ad.payment_methods];
    }
    return ['Bank Transfer'];
  }, [ad?.payment_methods]);

  // STRICT RULE: Force Username over full_name everywhere
  const username = ad?.user?.username || (ad as any)?.user_display_name || 'trader';
  const avatarUrl = ad?.user?.avatar_url || ad?.user?.photo_url || (ad?.user_id ? `/api/media/avatar/${ad.user_id}` : null);

  // Pricing calculations
  const isFixed = Boolean(
    ad?.is_fixed ||
    ad?.pricing_type === 'FIXED' ||
    ad?.rate_type === 'fixed'
  );

  const marginPercent = Number(
    ad?.margin ??
    ad?.rate_percent ??
    0
  );

  const marketPriceUsd = (prices && (prices as any)[assetSymbol]) || (assetSymbol === 'USDT' ? 1 : 0);
  const exchangeRate = (fiatRates && fiatRates[fiatSymbol]) || 1;
  const marketPriceInFiat = marketPriceUsd * exchangeRate;

  // Compute effective price
  const effectivePrice = useMemo(() => {
    if (!ad) return 0;
    if (isFixed && (ad.fixed_price || ad.fixed_rate || ad.price)) {
      return Number(ad.fixed_price || ad.fixed_rate || ad.price);
    }
    if (!isFixed && marketPriceInFiat > 0) {
      if (marginPercent !== 0) {
        return marketPriceInFiat * (1 + marginPercent / 100);
      }
      return Number(ad.price) || marketPriceInFiat;
    }
    return Number(ad.price || 0);
  }, [ad, isFixed, marginPercent, marketPriceInFiat]);

  // Compute percentage difference (+% / -%) relative to market price
  const priceDifferencePercent = useMemo(() => {
    if (marketPriceInFiat <= 0 || effectivePrice <= 0) {
      return marginPercent;
    }
    return ((effectivePrice - marketPriceInFiat) / marketPriceInFiat) * 100;
  }, [marketPriceInFiat, effectivePrice, marginPercent]);

  // STRICT LIMIT ONE RULE:
  // For SELL ads (where creator is selling crypto to user):
  // 1. If seller's balance < minLimit, ad is inactive / not available!
  // 2. If seller's balance < maxLimit (e.g. 530$), limit is minLimit to 530$!
  // 3. If seller's balance >= maxLimit, limit is minLimit to maxLimit (100 - 1000$)!
  const { effectiveMaxLimit, isBalanceTooLow, availableFiatBalance } = useMemo(() => {
    if (rawType !== 'SELL' || creatorCryptoBalance === null) {
      return {
        effectiveMaxLimit: baseMaxLimit,
        isBalanceTooLow: false,
        availableFiatBalance: baseMaxLimit,
      };
    }

    const availFiat = creatorCryptoBalance * (effectivePrice > 0 ? effectivePrice : 1);

    if (availFiat < baseMinLimit) {
      return {
        effectiveMaxLimit: baseMinLimit,
        isBalanceTooLow: true,
        availableFiatBalance: availFiat,
      };
    }

    if (availFiat < baseMaxLimit) {
      return {
        effectiveMaxLimit: Math.floor(availFiat * 100) / 100,
        isBalanceTooLow: false,
        availableFiatBalance: availFiat,
      };
    }

    return {
      effectiveMaxLimit: baseMaxLimit,
      isBalanceTooLow: false,
      availableFiatBalance: availFiat,
    };
  }, [rawType, creatorCryptoBalance, effectivePrice, baseMinLimit, baseMaxLimit]);

  // Handlers for calculator conversion
  const handleFiatChange = (val: string) => {
    setFiatAmount(val);
    if (!effectivePrice || !val || isNaN(Number(val)) || effectivePrice <= 0) {
      setCryptoAmount('');
      return;
    }
    setCryptoAmount((parseFloat(val) / effectivePrice).toFixed(8));
  };

  const handleCryptoChange = (val: string) => {
    setCryptoAmount(val);
    if (!effectivePrice || !val || isNaN(Number(val))) {
      setFiatAmount('');
      return;
    }
    setFiatAmount((parseFloat(val) * effectivePrice).toFixed(2));
  };

  const handleInitiateTrade = async () => {
    if (!ad || isBalanceTooLow) return;
    const fiatVal = parseFloat(fiatAmount);
    if (isNaN(fiatVal) || fiatVal < baseMinLimit || fiatVal > effectiveMaxLimit) {
      alert(`Trade amount must be between ${baseMinLimit.toLocaleString()} and ${effectiveMaxLimit.toLocaleString()} ${fiatSymbol}`);
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/p2p/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adId: ad.id,
          fiatAmount: fiatVal,
          cryptoAmount: parseFloat(cryptoAmount),
        }),
      });

      const data = await res.json();
      if (res.ok && data.tradeId) {
        router.push(`/trade/${data.tradeId}`);
      } else {
        alert(data.error || 'Failed to initiate escrow.');
      }
    } catch (err: any) {
      alert(err.message || 'Network error while initiating trade.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center gap-2 text-gray-500 dark:text-gray-400 font-sans text-sm">
        <RefreshCw className="w-5 h-5 animate-spin text-emerald-500" />
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
          onClick={() => router.push(rawType === 'SELL' ? '/buy' : '/sell')}
          className="mt-4 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-semibold hover:bg-emerald-700 transition-colors"
        >
          Return to Marketplace
        </button>
      </div>
    );
  }

  // Grammar Header Rule:
  // If ad type is SELL: creator is selling -> user is buying from creator -> "Buy {crypto} from @{username}"
  // If ad type is BUY: creator is buying -> user is selling to creator -> "Sell {crypto} to @{username}"
  const grammarTitle = rawType === 'SELL'
    ? `Buy ${assetSymbol} from`
    : `Sell ${assetSymbol} to`;

  const joinedText = formatJoinedDate(ad.user?.created_at);
  const avgReleaseText = ad.user?.avg_release_time || (ad.user?.avg_release_minutes ? `${ad.user.avg_release_minutes.toFixed(1)}m` : 'N/A');
  const avgPayText = ad.user?.avg_pay_time || (ad.user?.avg_payment_minutes ? `${ad.user.avg_payment_minutes.toFixed(1)}m` : avgReleaseText);

  const offerLabel = ad.offer_label || ad.offerLabel;
  const hasTerms = Boolean(ad.terms && ad.terms.trim().length > 0);
  const hasTags = Boolean(ad.tags && ad.tags.length > 0);

  return (
    <div className="min-h-screen bg-background text-foreground p-4 sm:p-6 lg:p-8">
      <div className="max-w-5xl mx-auto space-y-6">

        {/* Page Header */}
        <div className="border-b border-border pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="flex items-center gap-1.5 font-bold text-xs bg-muted/60 px-2 py-1 rounded-md border border-border">
                {assetSymbol === 'BTC' ? <BtcLogo className="h-4 w-4 shrink-0" /> : assetSymbol === 'USDT' ? <UsdtLogo className="h-4 w-4 shrink-0" /> : assetSymbol === 'ETH' ? <EthLogo className="h-4 w-4 shrink-0" /> : assetSymbol === 'LTC' ? <LtcLogo className="h-4 w-4 shrink-0" /> : null}
                <span>{assetSymbol === 'BTC' ? '₿ BTC' : assetSymbol}</span>
              </div>
              <div className="flex items-center gap-1.5 font-bold text-xs bg-muted/60 px-2 py-1 rounded-md border border-border">
                <FlagIcon countryCode={getCurrencyCountryCode(fiatSymbol)} className="h-3.5 w-5 rounded-xs" />
                <span>{fiatCurrencyConfig.symbol} {fiatSymbol}</span>
              </div>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              {grammarTitle} <span className="text-primary font-mono">@{username}</span>
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              Protected by Paxones Automated Escrow Protection.
            </p>
          </div>
          <Badge variant="outline" className="text-xs font-semibold px-3 py-1">
            {rawType === 'SELL' ? 'Seller Offer' : 'Buyer Offer'}
          </Badge>
        </div>

        {/* Balance Warning Banner if below minimum limit */}
        {isBalanceTooLow && (
          <div className="p-4 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive flex items-start gap-3">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-sm">Offer Currently Inactive</p>
              <p className="text-xs mt-0.5 opacity-90">
                The seller&apos;s available crypto balance ({availableFiatBalance.toFixed(2)} {fiatSymbol}) is currently below the required minimum trade limit ({baseMinLimit.toLocaleString()} {fiatSymbol}). This advertisement cannot accept new trades until the seller reloads their balance.
              </p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Left Columns (2 cols) */}
          <div className="lg:col-span-2 space-y-6">

            {/* Trader Details Card */}
            <div className="bg-card p-5 rounded-xl border border-border shadow-sm space-y-4">
              <h2 className="text-xs uppercase font-bold text-muted-foreground tracking-wider">Trader Profile</h2>

              <div className="flex items-center gap-4">
                <div className="relative">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={username}
                      className="w-14 h-14 rounded-full object-cover border border-border"
                      onError={(e) => {
                        (e.target as HTMLElement).style.display = 'none';
                      }}
                    />
                  ) : null}
                  {!avatarUrl && (
                    <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                      <UserIcon className="w-7 h-7" />
                    </div>
                  )}
                </div>

                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-lg">@{username}</span>
                    <ShieldCheck className="w-4 h-4 text-emerald-500" />
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                    <TraderStatusBadge lastActive={ad.user?.last_seen_at} />
                    <span>•</span>
                    <span>{joinedText}</span>
                  </div>
                </div>
              </div>

              {/* Real Performance Metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-border text-sm">
                <div className="p-2.5 rounded-lg bg-muted/40">
                  <span className="text-xs text-muted-foreground block">Trades</span>
                  <span className="font-bold">{ad.user?.completed_trades ?? 0}</span>
                </div>
                <div className="p-2.5 rounded-lg bg-muted/40">
                  <span className="text-xs text-muted-foreground block">Positive</span>
                  <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <ThumbsUp className="w-3.5 h-3.5" /> {ad.user?.positive_feedback ?? 0}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-muted/40">
                  <span className="text-xs text-muted-foreground block">Negative</span>
                  <span className="font-bold text-destructive flex items-center gap-1">
                    <ThumbsDown className="w-3.5 h-3.5" /> {ad.user?.negative_feedback ?? 0}
                  </span>
                </div>
                <div className="p-2.5 rounded-lg bg-muted/40">
                  <span className="text-xs text-muted-foreground block">
                    {rawType === 'SELL' ? 'Avg Release' : 'Avg Pay'}
                  </span>
                  <span className="font-bold text-foreground">
                    {rawType === 'SELL' ? avgReleaseText : avgPayText}
                  </span>
                </div>
              </div>
            </div>

            {/* Ad Price & Information Card */}
            <div className="bg-card p-5 rounded-xl border border-border shadow-sm space-y-4">
              <h2 className="text-xs uppercase font-bold text-muted-foreground tracking-wider">Offer Details</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-xs text-muted-foreground block">Unit Price</span>
                  <div className="flex items-baseline gap-2 mt-0.5 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <FlagIcon countryCode={getCurrencyCountryCode(fiatSymbol)} className="h-4 w-5 rounded-xs" />
                      <span className="text-2xl font-extrabold text-foreground">
                        {fiatCurrencyConfig.symbol}{effectivePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {fiatSymbol}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">/</span>
                    <div className="flex items-center gap-1 text-sm font-bold text-muted-foreground">
                      {assetSymbol === 'BTC' ? <BtcLogo className="h-4 w-4 shrink-0" /> : assetSymbol === 'USDT' ? <UsdtLogo className="h-4 w-4 shrink-0" /> : assetSymbol === 'ETH' ? <EthLogo className="h-4 w-4 shrink-0" /> : assetSymbol === 'LTC' ? <LtcLogo className="h-4 w-4 shrink-0" /> : null}
                      <span>{assetSymbol === 'BTC' ? '₿ BTC' : assetSymbol}</span>
                    </div>
                  </div>
                  {/* Percent increase or decrease indicator badge */}
                  <div className="mt-1 flex items-center gap-2">
                    {priceDifferencePercent !== 0 ? (
                      <Badge
                        className={cn(
                          'text-xs font-semibold px-2 py-0.5 flex items-center gap-1',
                          priceDifferencePercent > 0
                            ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20'
                            : 'bg-rose-500/10 text-rose-700 dark:text-rose-300 border border-rose-500/20'
                        )}
                      >
                        {priceDifferencePercent > 0 ? (
                          <>
                            <TrendingUp className="w-3 h-3" />
                            +{(priceDifferencePercent).toFixed(2)}% above market
                          </>
                        ) : (
                          <>
                            <TrendingDown className="w-3 h-3" />
                            {(priceDifferencePercent).toFixed(2)}% below market
                          </>
                        )}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">At market price</span>
                    )}
                  </div>
                </div>

                <div>
                  <span className="text-xs text-muted-foreground block">Trade Limits</span>
                  <span className="text-lg font-bold text-foreground block mt-0.5">
                    {fiatCurrencyConfig.symbol}{baseMinLimit.toLocaleString()} - {fiatCurrencyConfig.symbol}{effectiveMaxLimit.toLocaleString()} {fiatSymbol}
                  </span>
                  {rawType === 'SELL' && creatorCryptoBalance !== null && (
                    <span className="text-xs text-muted-foreground block mt-0.5">
                      {effectiveMaxLimit < baseMaxLimit
                        ? `(Capped to seller's available balance: ${fiatCurrencyConfig.symbol}${effectiveMaxLimit.toLocaleString()} ${fiatSymbol})`
                        : `(Seller balance supports full limit)`}
                    </span>
                  )}
                </div>

                <div>
                  <span className="text-xs text-muted-foreground block">Payment Window</span>
                  <span className="font-semibold flex items-center gap-1.5 mt-0.5">
                    <Clock className="w-4 h-4 text-amber-500" /> {paymentWindow} minutes
                  </span>
                </div>

                <div>
                  <span className="text-xs text-muted-foreground block">Payment Methods</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {paymentMethodsList.map((pm, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs font-medium">
                        {pm}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              {/* Offer Label if configured */}
              {offerLabel && (
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-200">
                  <p className="text-xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">Offer Label</p>
                  <p className="text-sm font-bold mt-0.5">{offerLabel}</p>
                </div>
              )}

              {/* Tags */}
              {hasTags && (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {ad.tags!.map((tag, idx) => (
                    <Badge key={idx} variant="secondary" className="text-xs">
                      {tag}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* Terms & Conditions Card */}
            {hasTerms && (
              <div className="bg-card p-5 rounded-xl border border-border shadow-sm space-y-2">
                <h2 className="text-sm font-semibold flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-500" /> Offer Terms & Conditions
                </h2>
                <div className="text-sm whitespace-pre-line text-muted-foreground leading-relaxed p-3 rounded-lg bg-muted/30 border border-border/50">
                  {ad.terms}
                </div>
              </div>
            )}

          </div>

          {/* Right Column: Start Trade Box (Calculator word removed) */}
          <div className="bg-card p-5 rounded-xl border border-border shadow-sm h-fit space-y-5">
            <div>
              <h2 className="text-base font-bold text-foreground">
                {rawType === 'SELL' ? `Buy ${assetSymbol}` : `Sell ${assetSymbol}`}
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {rawType === 'SELL' ? 'Enter payment amount to receive crypto' : 'Enter crypto amount to receive fiat'}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1">
                  {rawType === 'SELL' ? 'I want to pay' : 'I will receive'} ({fiatSymbol})
                </label>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    placeholder={`Limit: ${baseMinLimit} - ${effectiveMaxLimit}`}
                    value={fiatAmount}
                    onChange={(e) => handleFiatChange(e.target.value)}
                    disabled={isBalanceTooLow}
                    className="w-full px-3 py-2.5 rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary outline-none text-sm pr-24 disabled:opacity-50"
                  />
                  <div className="absolute right-3 flex items-center gap-1.5 pointer-events-none select-none">
                    <FlagIcon countryCode={getCurrencyCountryCode(fiatSymbol)} className="h-3.5 w-5 rounded-xs" />
                    <span className="text-xs font-bold text-foreground">
                      {fiatCurrencyConfig.symbol} {fiatSymbol}
                    </span>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  Min: {fiatCurrencyConfig.symbol}{baseMinLimit.toLocaleString()} | Max: {fiatCurrencyConfig.symbol}{effectiveMaxLimit.toLocaleString()} {fiatSymbol}
                </p>
              </div>

              <div>
                <label className="text-xs font-semibold text-muted-foreground block mb-1">
                  {rawType === 'SELL' ? 'I will receive' : 'I want to sell'} ({assetSymbol})
                </label>
                <div className="relative flex items-center">
                  <input
                    type="number"
                    placeholder="0.00000000"
                    value={cryptoAmount}
                    onChange={(e) => handleCryptoChange(e.target.value)}
                    disabled={isBalanceTooLow}
                    className="w-full px-3 py-2.5 rounded-lg border border-input bg-background focus:ring-2 focus:ring-primary outline-none text-sm pr-24 disabled:opacity-50"
                  />
                  <div className="absolute right-3 flex items-center gap-1.5 pointer-events-none select-none">
                    {assetSymbol === 'BTC' ? <BtcLogo className="h-4 w-4 shrink-0" /> : assetSymbol === 'USDT' ? <UsdtLogo className="h-4 w-4 shrink-0" /> : assetSymbol === 'ETH' ? <EthLogo className="h-4 w-4 shrink-0" /> : assetSymbol === 'LTC' ? <LtcLogo className="h-4 w-4 shrink-0" /> : null}
                    <span className="text-xs font-bold text-foreground">
                      {assetSymbol === 'BTC' ? '₿ BTC' : assetSymbol}
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <button
              onClick={handleInitiateTrade}
              disabled={
                submitting ||
                isBalanceTooLow ||
                !fiatAmount ||
                Number(fiatAmount) < baseMinLimit ||
                Number(fiatAmount) > effectiveMaxLimit
              }
              className={`w-full py-3 rounded-lg font-bold text-white transition-all flex items-center justify-center gap-2 ${
                isBalanceTooLow
                  ? 'bg-gray-400 dark:bg-gray-700 cursor-not-allowed'
                  : rawType === 'SELL'
                  ? 'bg-emerald-600 hover:bg-emerald-700 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed'
                  : 'bg-rose-600 hover:bg-rose-700 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed'
              }`}
            >
              {submitting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Initiating Escrow...</span>
                </>
              ) : isBalanceTooLow ? (
                <span>Insufficient Seller Balance</span>
              ) : (
                <>
                  <span>{rawType === 'SELL' ? `Buy ${assetSymbol}` : `Sell ${assetSymbol}`}</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>

            <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border">
              <div className="flex justify-between">
                <span>Escrow Fee</span>
                <span className="font-semibold text-emerald-600 dark:text-emerald-400">0% for Taker</span>
              </div>
              <div className="flex justify-between">
                <span>Payment Window</span>
                <span>{paymentWindow} minutes</span>
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
