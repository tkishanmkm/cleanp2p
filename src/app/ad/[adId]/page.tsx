'use client';

import { useState, useEffect, useMemo } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { formatJoinedDate } from '@/utils/p2p-helpers';
import { usePrices } from '@/context/price-context';
import { useAuth } from '@/components/providers/auth-provider';
import { useWallet } from '@/context/wallet-context';
import TraderStatusBadge from '@/components/TraderStatusBadge';
import { FlagIcon } from '@/components/ui/flag-icon';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
import { FIAT_CURRENCIES } from '@/lib/currencies';
import type { CryptoCurrency } from '@/lib/types';
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
  Wallet,
  CheckCircle2,
  FileText,
  Tag,
  Info,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getPublicHandle, formatCurrencyValue } from '@/utils/userPrivacy';

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
  };
  return customMap[code] || code.slice(0, 2).toLowerCase();
}

export default function AdDetailPage() {
  const params = useParams();
  const router = useRouter();
  const adId = params?.adId as string;

  const { user } = useAuth();
  const { balances } = useWallet();
  const { prices, fiatRates } = usePrices();

  const [ad, setAd] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  // Trade calculator state
  const [fiatAmount, setFiatAmount] = useState<string>('');
  const [cryptoAmount, setCryptoAmount] = useState<string>('');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [fundCheckError, setFundCheckError] = useState<string | null>(null);

  // Escrow fee constant (1.5%)
  const ESCROW_FEE_PERCENT = 1.5;

  // Real-time seller crypto balance
  const [creatorCryptoBalance, setCreatorCryptoBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!adId) return;

    let isMounted = true;
    const supabase = createClient();

    async function fetchAdDetails() {
      setLoading(true);
      setErrorText(null);

      try {
        let fetchedAd: any = null;

        // 1. Try fetching via API route
        try {
          const res = await fetch(`/api/ads/${adId}`);
          if (res.ok) {
            const json = await res.json();
            if (json && (json.id || json.ad?.id)) {
              fetchedAd = json.ad || json;
            }
          }
        } catch (apiErr) {
          console.warn('API ad fetch fallback:', apiErr);
        }

        // 2. If not fetched from API, query Supabase directly
        if (!fetchedAd) {
          const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(adId);
          let rawAd: any = null;

          if (isUuid) {
            const { data } = await supabase
              .from('p2p_ads')
              .select('*')
              .eq('id', adId)
              .maybeSingle();
            rawAd = data;
          }

          if (!rawAd) {
            const { data } = await supabase
              .from('p2p_ads')
              .select('*')
              .or(`public_ad_id.eq.${adId},id.eq.${adId}`)
              .maybeSingle();
            rawAd = data;
          }

          if (!rawAd) {
            const { data: fallbackTableAd } = await supabase
              .from('ads')
              .select('*')
              .eq('id', adId)
              .maybeSingle();
            rawAd = fallbackTableAd;
          }

          if (rawAd) {
            // Load user profile separately without risking foreign key join error
            let profileData: any = null;
            if (rawAd.user_id) {
              const { data: profile } = await supabase
                .from('profiles')
                .select('*')
                .eq('id', rawAd.user_id)
                .maybeSingle();
              profileData = profile;
            }

            const fallbackUsername = profileData?.username || rawAd.user_display_name || rawAd.username || 'trader';

            fetchedAd = {
              ...rawAd,
              user: profileData ? {
                ...profileData,
                username: profileData.username || fallbackUsername,
              } : {
                id: rawAd.user_id,
                username: fallbackUsername,
                completed_trades: 0,
                positive_feedback: 0,
                negative_feedback: 0,
              },
            };
          }
        }

        if (!fetchedAd) {
          if (isMounted) setErrorText('Advertisement could not be found or has been removed.');
          return;
        }

        if (isMounted) {
          setAd(fetchedAd);

          // If ad is SELL (creator is selling crypto), fetch real-time wallet balance
          const adType = (fetchedAd.type || fetchedAd.side || fetchedAd.ad_type || 'SELL').toUpperCase();
          if (adType === 'SELL' && fetchedAd.user_id) {
            const asset = (fetchedAd.crypto_currency || fetchedAd.asset || fetchedAd.coin || 'BTC').toUpperCase();
            try {
              const { data: balanceData } = await supabase
                .from('wallets')
                .select('balance, available_balance')
                .eq('user_id', fetchedAd.user_id)
                .eq('currency', asset)
                .maybeSingle();

              if (balanceData) {
                const avail = Number(balanceData.available_balance ?? balanceData.balance ?? 0);
                setCreatorCryptoBalance(avail);
              } else {
                setCreatorCryptoBalance(100);
              }
            } catch (bErr) {
              setCreatorCryptoBalance(100);
            }
          }
        }
      } catch (err: any) {
        if (isMounted) setErrorText(err.message || 'Failed to load advertisement.');
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    fetchAdDetails();

    return () => {
      isMounted = false;
    };
  }, [adId]);

  // Derived properties
  const assetSymbol = (ad?.crypto_currency || ad?.asset || 'BTC').toUpperCase() as CryptoCurrency;
  const fiatSymbol = (ad?.fiat_currency || ad?.fiat || 'USD').toUpperCase();
  const rawType = (ad?.type || ad?.side || 'SELL').toUpperCase(); // 'SELL' or 'BUY'

  // Standard fiat symbol formatting (INR uses ₹, never $)
  const fiatCurrencyConfig = useMemo(() => {
    const found = FIAT_CURRENCIES.find((c) => c.code.toUpperCase() === fiatSymbol);
    if (found) return found;
    return {
      code: fiatSymbol,
      name: fiatSymbol,
      symbol: fiatSymbol === 'INR' ? '₹' : fiatSymbol === 'USD' ? '$' : fiatSymbol === 'EUR' ? '€' : fiatSymbol === 'GBP' ? '£' : fiatSymbol,
    };
  }, [fiatSymbol]);

  const paymentMethodsList = useMemo(() => {
    const rawMethods = ad?.payment_methods || ad?.payment_method || ad?.paymentMethods || ad?.paymentMethod;
    if (!rawMethods) return ['Bank Transfer'];
    if (Array.isArray(rawMethods)) {
      return rawMethods.filter(Boolean);
    }
    if (typeof rawMethods === 'string') {
      try {
        if (rawMethods.trim().startsWith('[')) {
          const parsed = JSON.parse(rawMethods);
          if (Array.isArray(parsed)) return parsed.filter(Boolean);
        }
      } catch {}
      if (rawMethods.includes(',')) {
        return rawMethods.split(',').map((s: string) => s.trim()).filter(Boolean);
      }
      return [rawMethods.trim()];
    }
    return ['Bank Transfer'];
  }, [ad?.payment_methods, ad?.payment_method, ad?.paymentMethods, ad?.paymentMethod]);

  // Username display
  const sellerHandle = getPublicHandle(ad?.user?.username || (ad as any)?.profiles?.username || (ad as any)?.user_display_name || 'pulsepost949');
  const username = sellerHandle.replace('@', '');
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

  const defaultCryptoPrices: Record<string, number> = {
    BTC: 65000,
    ETH: 3500,
    USDT: 1,
    LTC: 85,
  };
  const marketPriceUsd = (prices && Number((prices as any)[assetSymbol])) || defaultCryptoPrices[assetSymbol] || (assetSymbol === 'USDT' ? 1 : 65000);
  const exchangeRate = (fiatRates && Number(fiatRates[fiatSymbol])) || (fiatSymbol === 'INR' ? 86 : 1);
  const marketPriceInFiat = marketPriceUsd * exchangeRate;

  // Compute effective price
  const effectivePrice = useMemo(() => {
    if (!ad) return 0;
    if (isFixed && (ad.fixed_price !== undefined && ad.fixed_price !== null || ad.fixed_rate !== undefined && ad.fixed_rate !== null || ad.price)) {
      return Number(ad.fixed_price || ad.fixed_rate || ad.price);
    }
    if (marketPriceInFiat > 0) {
      if (marginPercent !== 0) {
        return marketPriceInFiat * (1 + marginPercent / 100);
      }
      return Number(ad.price) || marketPriceInFiat;
    }
    return Number(ad.price || 0);
  }, [ad, isFixed, marginPercent, marketPriceInFiat]);

  // Compute percentage difference (+% / -%) relative to market price
  const priceDifferencePercent = useMemo(() => {
    if (!isFixed) {
      return marginPercent;
    }
    if (marketPriceInFiat <= 0 || effectivePrice <= 0) {
      return 0;
    }
    return ((effectivePrice - marketPriceInFiat) / marketPriceInFiat) * 100;
  }, [isFixed, marginPercent, marketPriceInFiat, effectivePrice]);

  // Limits calculation
  const baseMinLimit = Number(ad?.min_limit || 0);
  const baseMaxLimit = Number(ad?.max_limit || 0);

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

  // User wallet balance check for visitor selling crypto
  const userAvailableCrypto = useMemo(() => {
    if (!assetSymbol) return 0;
    return balances?.[assetSymbol]?.available ?? 0;
  }, [balances, assetSymbol]);

  const isVisitorSelling = rawType === 'BUY'; // Ad is BUY -> Visitor is Selling crypto to creator
  const isVisitorBuying = rawType === 'SELL'; // Ad is SELL -> Visitor is Buying crypto from creator

  // Handlers for calculator conversion with 1.5% Escrow Fee deduction
  const handleFiatChange = (val: string) => {
    setFiatAmount(val);
    setFundCheckError(null);
    if (!effectivePrice || !val || isNaN(Number(val)) || effectivePrice <= 0) {
      setCryptoAmount('');
      return;
    }
    const fiatVal = parseFloat(val);
    if (isVisitorBuying) {
      // Visitor is BUYING crypto:
      // Gross crypto = fiatVal / effectivePrice.
      // Escrow fee (1.5%) is deducted, so buyer receives net:
      const grossCrypto = fiatVal / effectivePrice;
      const netCrypto = grossCrypto * (1 - ESCROW_FEE_PERCENT / 100);
      setCryptoAmount(netCrypto.toFixed(8));
    } else {
      // Visitor is SELLING crypto:
      // Visitor receives fiatVal. Gross crypto needed = fiatVal / effectivePrice.
      const grossCrypto = fiatVal / effectivePrice;
      setCryptoAmount(grossCrypto.toFixed(8));
    }
  };

  const handleCryptoChange = (val: string) => {
    setCryptoAmount(val);
    setFundCheckError(null);
    if (!effectivePrice || !val || isNaN(Number(val)) || effectivePrice <= 0) {
      setFiatAmount('');
      return;
    }
    const cryptoVal = parseFloat(val);
    if (isVisitorBuying) {
      // Visitor entered net crypto they want to receive.
      // Gross crypto = cryptoVal / (1 - 0.015).
      const grossCrypto = cryptoVal / (1 - ESCROW_FEE_PERCENT / 100);
      const reqFiat = grossCrypto * effectivePrice;
      setFiatAmount(reqFiat.toFixed(2));
    } else {
      // Visitor entered crypto they want to sell.
      const grossFiat = cryptoVal * effectivePrice;
      setFiatAmount(grossFiat.toFixed(2));
    }
  };

  // Fee calculation for display
  const feeDetails = useMemo(() => {
    const cNum = parseFloat(cryptoAmount) || 0;
    if (cNum <= 0) return { feeCrypto: '0.00000000', grossCrypto: 0 };
    if (isVisitorBuying) {
      const gross = cNum / (1 - ESCROW_FEE_PERCENT / 100);
      const fee = gross * (ESCROW_FEE_PERCENT / 100);
      return { feeCrypto: fee.toFixed(8), grossCrypto: gross };
    } else {
      const fee = cNum * (ESCROW_FEE_PERCENT / 100);
      return { feeCrypto: fee.toFixed(8), grossCrypto: cNum };
    }
  }, [cryptoAmount, isVisitorBuying]);

  // Offer tags and terms formatting
  const parsedTags: string[] = useMemo(() => {
    const rawTags = ad?.tags || (ad as any)?.offer_tags || (ad as any)?.offerTags;
    if (!rawTags) return [];
    if (Array.isArray(rawTags)) return rawTags.map(String).filter(Boolean);
    if (typeof rawTags === 'string') {
      try {
        if (rawTags.trim().startsWith('[')) {
          const parsed = JSON.parse(rawTags);
          if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
        }
      } catch {}
      return rawTags.split(',').map((s: string) => s.trim()).filter(Boolean);
    }
    return [];
  }, [ad]);

  // Pre-trade fund check on initiating trade
  const handleInitiateTrade = async () => {
    setFundCheckError(null);

    if (!ad || isBalanceTooLow) return;

    if (!user) {
      setFundCheckError('Please sign in to initiate this trade.');
      return;
    }

    const fiatVal = parseFloat(fiatAmount);
    if (isNaN(fiatVal) || fiatVal < baseMinLimit || fiatVal > effectiveMaxLimit) {
      setFundCheckError(
        `Trade amount must be between ${baseMinLimit.toLocaleString()} and ${effectiveMaxLimit.toLocaleString()} ${fiatSymbol}`
      );
      return;
    }

    const cryptoVal = parseFloat(cryptoAmount);
    if (isNaN(cryptoVal) || cryptoVal <= 0) {
      setFundCheckError('Please enter a valid trade amount.');
      return;
    }

    // Pre-Trade Fund Check for Visitor Selling Crypto (Instruction 7)
    if (isVisitorSelling) {
      const requiredCrypto = cryptoVal;
      if (userAvailableCrypto < requiredCrypto) {
        setFundCheckError(
          `Insufficient ${assetSymbol} balance. You need at least ${requiredCrypto.toFixed(8)} ${assetSymbol} to initiate this trade, but your available balance is ${userAvailableCrypto.toFixed(8)} ${assetSymbol}. Please adjust your trade amount or deposit ${assetSymbol} into your wallet.`
        );
        return;
      }
    }

    setSubmitting(true);
    try {
      const res = await fetch('/api/p2p/orders/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adId: ad.id,
          fiatAmount: fiatVal,
          cryptoAmount: feeDetails.grossCrypto || cryptoVal,
        }),
      });

      const data = await res.json();
      if (res.ok && data.tradeId) {
        router.push(`/trade/${data.tradeId}`);
      } else {
        setFundCheckError(data.error || 'Failed to initiate trade.');
      }
    } catch (err: any) {
      setFundCheckError(err.message || 'Network error while initiating trade.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center gap-2 text-muted-foreground font-sans text-sm">
        <RefreshCw className="w-5 h-5 animate-spin text-[#9273FC]" />
        <span>Loading offer details...</span>
      </div>
    );
  }

  if (errorText || !ad) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-4 text-center">
        <AlertCircle className="w-10 h-10 text-rose-500 mb-2" />
        <h1 className="text-lg font-bold text-foreground">Advertisement unavailable</h1>
        <p className="text-sm text-muted-foreground max-w-md mt-1">{errorText}</p>
        <button
          onClick={() => router.push(rawType === 'SELL' ? '/buy' : '/sell')}
          className="mt-4 px-4 py-2 bg-[#9273FC] text-white rounded-xl text-sm font-semibold hover:bg-[#8261FA] transition-colors"
        >
          Return to Marketplace
        </button>
      </div>
    );
  }

  const grammarTitle = isVisitorBuying
    ? `Buy ${assetSymbol} from`
    : `Sell ${assetSymbol} to`;

  const joinedText = formatJoinedDate(ad.user?.created_at);
  const avgReleaseText = ad.user?.avg_release_time || (ad.user?.avg_release_minutes ? `${ad.user.avg_release_minutes.toFixed(1)}m` : 'N/A');
  const avgPayText = ad.user?.avg_pay_time || (ad.user?.avg_payment_minutes ? `${ad.user.avg_payment_minutes.toFixed(1)}m` : avgReleaseText);

  const offerLabel = ad.offer_label || ad.offerLabel || (ad as any).label;

  const hasTags = parsedTags.length > 0;
  const termsText = (ad.terms || (ad as any).terms_of_trade || (ad as any).trade_terms || (ad as any).termsAndConditions || '').trim();
  const hasTerms = Boolean(termsText);
  const paymentWindow = ad.payment_window || (ad as any).payment_window_minutes || (ad as any).paymentWindow || 30;

  // Fund warning check for visitor selling crypto
  const isInsufficientFundActive = isVisitorSelling && user && userAvailableCrypto < (parseFloat(cryptoAmount) || 0);

  return (
    <div className="min-h-screen bg-background text-foreground p-4 sm:p-6 lg:p-8">
      <div className="max-w-4xl mx-auto space-y-6">

        {/* Page Header */}
        <div className="border-b border-border pb-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="flex items-center gap-1.5 font-bold text-xs bg-muted/60 px-2.5 py-1 rounded-md border border-border">
                {assetSymbol === 'BTC' ? <BtcLogo className="h-4 w-4 shrink-0" /> : assetSymbol === 'USDT' ? <UsdtLogo className="h-4 w-4 shrink-0" /> : assetSymbol === 'ETH' ? <EthLogo className="h-4 w-4 shrink-0" /> : assetSymbol === 'LTC' ? <LtcLogo className="h-4 w-4 shrink-0" /> : null}
                <span>{assetSymbol}</span>
              </div>
            </div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight">
              {grammarTitle} <span className="text-primary font-mono">{sellerHandle}</span>
            </h1>
            <p className="text-xs text-muted-foreground mt-1">
              Protected by Paxones Automated Escrow Protection.
            </p>
          </div>
          <Badge variant="outline" className="text-xs font-semibold px-3 py-1 border-[#9273FC]/30 text-[#9273FC]">
            {rawType === 'SELL' ? 'Seller Offer' : 'Buyer Offer'}
          </Badge>
        </div>

        {/* Balance Warning Banner if seller crypto balance is below minimum limit */}
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

        {/* ========================================================================= */}
        {/* REARRANGED ORDER:                                                        */}
        {/* 1. SELL/BUY BTC BOX                                                      */}
        {/* 2. OFFER DETAILS & TERMS                                                 */}
        {/* 3. TRADER PROFILE                                                        */}
        {/* ========================================================================= */}

        {/* 1. TRADE ACTION BOX (SELL / BUY BTC BOX) */}
        <div className="bg-card p-6 rounded-2xl border border-border shadow-lg space-y-5">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <div>
              <h2 className="text-lg font-bold text-foreground flex items-center gap-2">
                {assetSymbol === 'BTC' ? <BtcLogo className="h-5 w-5 shrink-0" /> : assetSymbol === 'USDT' ? <UsdtLogo className="h-5 w-5 shrink-0" /> : assetSymbol === 'ETH' ? <EthLogo className="h-5 w-5 shrink-0" /> : assetSymbol === 'LTC' ? <LtcLogo className="h-5 w-5 shrink-0" /> : null}
                <span>{isVisitorBuying ? `Buy ${assetSymbol}` : `Sell ${assetSymbol}`}</span>
              </h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isVisitorBuying ? 'Enter payment amount to receive crypto' : 'Enter crypto amount to receive fiat'}
              </p>
            </div>
            <div className="text-right">
              <span className="text-[11px] text-muted-foreground block">Rate</span>
              <span className="text-sm font-bold font-mono text-foreground flex items-center justify-end gap-1">
                <span>1 {assetSymbol} =</span>
                <span>{fiatCurrencyConfig.symbol}{effectivePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {fiatSymbol}</span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Input 1: I want to pay / I want to sell */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                {isVisitorBuying ? 'I want to pay' : 'I want to sell'} ({isVisitorBuying ? fiatSymbol : assetSymbol})
              </label>
              <div className="relative flex items-center">
                {isVisitorBuying ? (
                  <>
                    <input
                      type="number"
                      placeholder={`Limit: ${baseMinLimit.toLocaleString()} - ${effectiveMaxLimit.toLocaleString()} ${fiatSymbol}`}
                      value={fiatAmount}
                      onChange={(e) => handleFiatChange(e.target.value)}
                      disabled={isBalanceTooLow}
                      className="w-full px-3.5 py-3 rounded-xl border border-input bg-background focus:ring-2 focus:ring-[#9273FC] outline-none text-sm pr-20 disabled:opacity-50"
                    />
                    <div className="absolute right-3 flex items-center gap-1.5 pointer-events-none select-none">
                      <FlagIcon countryCode={getCurrencyCountryCode(fiatSymbol)} className="h-3.5 w-5 rounded-xs" />
                      <span className="text-xs font-bold text-foreground">
                        {fiatSymbol}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <input
                      type="number"
                      placeholder="0.00000000"
                      value={cryptoAmount}
                      onChange={(e) => handleCryptoChange(e.target.value)}
                      disabled={isBalanceTooLow}
                      className="w-full px-3.5 py-3 rounded-xl border border-input bg-background focus:ring-2 focus:ring-[#9273FC] outline-none text-sm pr-20 disabled:opacity-50"
                    />
                    <div className="absolute right-3 flex items-center gap-1.5 pointer-events-none select-none">
                      {assetSymbol === 'BTC' ? <BtcLogo className="h-4 w-4 shrink-0" /> : assetSymbol === 'USDT' ? <UsdtLogo className="h-4 w-4 shrink-0" /> : assetSymbol === 'ETH' ? <EthLogo className="h-4 w-4 shrink-0" /> : assetSymbol === 'LTC' ? <LtcLogo className="h-4 w-4 shrink-0" /> : null}
                      <span className="text-xs font-bold text-foreground">
                        {assetSymbol}
                      </span>
                    </div>
                  </>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                Limit: {baseMinLimit.toLocaleString()} - {effectiveMaxLimit.toLocaleString()} {fiatSymbol}
              </p>
            </div>

            {/* Input 2: I will receive (NO $ symbol, only flag and currency code) */}
            <div>
              <label className="text-xs font-semibold text-muted-foreground block mb-1">
                I will receive ({isVisitorBuying ? assetSymbol : fiatSymbol})
              </label>
              <div className="relative flex items-center">
                {isVisitorBuying ? (
                  <>
                    <input
                      type="number"
                      placeholder="0.00000000"
                      value={cryptoAmount}
                      onChange={(e) => handleCryptoChange(e.target.value)}
                      disabled={isBalanceTooLow}
                      className="w-full px-3.5 py-3 rounded-xl border border-input bg-background focus:ring-2 focus:ring-[#9273FC] outline-none text-sm pr-20 disabled:opacity-50 font-mono"
                    />
                    <div className="absolute right-3 flex items-center gap-1.5 pointer-events-none select-none">
                      {assetSymbol === 'BTC' ? <BtcLogo className="h-4 w-4 shrink-0" /> : assetSymbol === 'USDT' ? <UsdtLogo className="h-4 w-4 shrink-0" /> : assetSymbol === 'ETH' ? <EthLogo className="h-4 w-4 shrink-0" /> : assetSymbol === 'LTC' ? <LtcLogo className="h-4 w-4 shrink-0" /> : null}
                      <span className="text-xs font-bold text-foreground">
                        {assetSymbol}
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <input
                      type="number"
                      placeholder={`Limit: ${baseMinLimit.toLocaleString()} - ${effectiveMaxLimit.toLocaleString()} ${fiatSymbol}`}
                      value={fiatAmount}
                      onChange={(e) => handleFiatChange(e.target.value)}
                      disabled={isBalanceTooLow}
                      className="w-full px-3.5 py-3 rounded-xl border border-input bg-background focus:ring-2 focus:ring-[#9273FC] outline-none text-sm pr-20 disabled:opacity-50 font-mono"
                    />
                    {/* NO '$' symbol. Strictly only country flag and currency short name (Instruction 5) */}
                    <div className="absolute right-3 flex items-center gap-1.5 pointer-events-none select-none">
                      <FlagIcon countryCode={getCurrencyCountryCode(fiatSymbol)} className="h-3.5 w-5 rounded-xs" />
                      <span className="text-xs font-bold text-foreground">
                        {fiatSymbol}
                      </span>
                    </div>
                  </>
                )}
              </div>
              <p className="text-[11px] text-muted-foreground mt-1">
                {isVisitorBuying ? 'Net crypto transferred to your wallet' : 'Fiat transferred via payment method'}
              </p>
            </div>
          </div>

          {/* Pre-Trade Fund Check Error (Instruction 7) */}
          {(fundCheckError || isInsufficientFundActive) && (
            <div className="p-3.5 rounded-xl bg-destructive/10 border border-destructive/30 text-destructive text-xs space-y-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span className="font-medium leading-relaxed">
                  {fundCheckError || (
                    `Insufficient ${assetSymbol} balance. You need at least ${(parseFloat(cryptoAmount) || 0).toFixed(8)} ${assetSymbol} to initiate this trade, but your available balance is ${userAvailableCrypto.toFixed(8)} ${assetSymbol}. Please adjust your trade amount or deposit ${assetSymbol} into your wallet.`
                  )}
                </span>
              </div>
              {isVisitorSelling && (
                <div className="pt-1 flex items-center gap-2">
                  <Link
                    href="/wallets"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-destructive text-destructive-foreground font-semibold text-xs hover:opacity-90 transition-all"
                  >
                    <Wallet className="w-3.5 h-3.5" /> Deposit {assetSymbol}
                  </Link>
                </div>
              )}
            </div>
          )}

          {/* Escrow Fee Breakdown */}
          <div className="p-3.5 rounded-xl bg-muted/40 border border-border/80 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 text-[#9273FC]" /> Escrow Fee (1.5%)
              </span>
              <span className="font-mono font-semibold text-foreground flex items-center gap-1">
                {assetSymbol === 'BTC' ? <BtcLogo className="h-3.5 w-3.5 shrink-0" /> : assetSymbol === 'USDT' ? <UsdtLogo className="h-3.5 w-3.5 shrink-0" /> : assetSymbol === 'ETH' ? <EthLogo className="h-3.5 w-3.5 shrink-0" /> : assetSymbol === 'LTC' ? <LtcLogo className="h-3.5 w-3.5 shrink-0" /> : null}
                <span>{feeDetails.feeCrypto} {assetSymbol}</span>
              </span>
            </div>
          </div>

          {/* Action Button: Renamed to "Initiate Trade" (Instruction 8) */}
          <button
            onClick={handleInitiateTrade}
            disabled={
              submitting ||
              isBalanceTooLow ||
              !fiatAmount ||
              Number(fiatAmount) < baseMinLimit ||
              Number(fiatAmount) > effectiveMaxLimit ||
              Boolean(isInsufficientFundActive)
            }
            className={`w-full py-3.5 rounded-xl font-bold text-white transition-all duration-200 flex items-center justify-center gap-2 text-base shadow-lg ${
              isBalanceTooLow || isInsufficientFundActive
                ? 'bg-gray-400 dark:bg-gray-700 cursor-not-allowed opacity-60'
                : 'bg-[#9273FC] hover:bg-[#8261FA] shadow-[#9273FC]/25 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed'
            }`}
          >
            {submitting ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Initiating Trade...</span>
              </>
            ) : isBalanceTooLow ? (
              <span>Insufficient Seller Balance</span>
            ) : isInsufficientFundActive ? (
              <span>Insufficient Wallet Balance</span>
            ) : (
              <>
                <span>Initiate Trade</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>
        </div>

        {/* 2. OFFER DETAILS & TERMS */}
        <div className="bg-card p-6 rounded-2xl border border-border shadow-sm space-y-5">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <h2 className="text-sm uppercase font-bold text-muted-foreground tracking-wider flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#9273FC]" /> Offer Details & Terms
            </h2>
            {offerLabel && (
              <Badge variant="outline" className="text-xs bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30">
                {offerLabel}
              </Badge>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 text-sm">
            <div>
              <span className="text-xs text-muted-foreground block">Unit Price</span>
              <div className="flex items-baseline gap-2 mt-0.5 flex-wrap">
                <span className="text-xl sm:text-2xl font-extrabold text-foreground font-mono">
                  {fiatCurrencyConfig.symbol}{effectivePrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {fiatSymbol}
                </span>
                <span className="text-xs text-muted-foreground">/ {assetSymbol}</span>
              </div>
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
              <span className="text-base sm:text-lg font-bold text-foreground font-mono block mt-0.5">
                {fiatCurrencyConfig.symbol}{baseMinLimit.toLocaleString()} - {fiatCurrencyConfig.symbol}{effectiveMaxLimit.toLocaleString()} {fiatSymbol}
              </span>
              {rawType === 'SELL' && creatorCryptoBalance !== null && (
                <span className="text-xs text-muted-foreground block mt-0.5">
                  {effectiveMaxLimit < baseMaxLimit
                    ? `(Capped to seller balance: ${fiatCurrencyConfig.symbol}${effectiveMaxLimit.toLocaleString()} ${fiatSymbol})`
                    : `(Seller balance supports full limit)`}
                </span>
              )}
            </div>

            <div>
              <span className="text-xs text-muted-foreground block">Payment Window</span>
              <span className="font-semibold flex items-center gap-1.5 mt-0.5 text-foreground">
                <Clock className="w-4 h-4 text-amber-500" /> {paymentWindow} minutes
              </span>
            </div>

            <div>
              <span className="text-xs text-muted-foreground block">Payment Methods</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {paymentMethodsList.map((pm, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs font-medium">
                    {pm}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          {/* Tags */}
          {hasTags && (
            <div className="pt-2 border-t border-border/50">
              <span className="text-xs text-muted-foreground block mb-1.5">Offer Tags</span>
              <div className="flex flex-wrap gap-1.5">
                {parsedTags.map((tag: string, idx: number) => (
                  <Badge key={idx} variant="secondary" className="text-xs flex items-center gap-1">
                    <Tag className="w-3 h-3" /> {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Terms & Conditions */}
          {hasTerms && (
            <div className="pt-3 border-t border-border/50 space-y-2">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 text-amber-500" /> Terms and Conditions
              </span>
              <div className="text-xs whitespace-pre-line text-muted-foreground leading-relaxed p-3.5 rounded-xl bg-muted/30 border border-border/50">
                {termsText}
              </div>
            </div>
          )}
        </div>

        {/* 3. TRADER PROFILE */}
        <div className="bg-card p-6 rounded-2xl border border-border shadow-sm space-y-4">
          <div className="flex items-center justify-between border-b border-border/60 pb-3">
            <h2 className="text-xs uppercase font-bold text-muted-foreground tracking-wider">Trader Profile</h2>
            <div className="flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              <ShieldCheck className="w-4 h-4" /> Verified Trader
            </div>
          </div>

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
                <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center text-muted-foreground border border-border">
                  <UserIcon className="w-7 h-7" />
                </div>
              )}
            </div>

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-bold text-lg text-foreground">@{username}</span>
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                <TraderStatusBadge lastActive={ad.user?.last_seen_at} />
                <span>•</span>
                <span>{joinedText}</span>
              </div>
            </div>
          </div>

          {/* Trader Performance Metrics */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-border text-sm">
            <div className="p-3 rounded-xl bg-muted/40">
              <span className="text-xs text-muted-foreground block">Completed Trades</span>
              <span className="font-bold text-foreground text-base">{ad.user?.completed_trades ?? 0}</span>
            </div>
            <div className="p-3 rounded-xl bg-muted/40">
              <span className="text-xs text-muted-foreground block">Positive Feedback</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1 text-base">
                <ThumbsUp className="w-3.5 h-3.5" /> {ad.user?.positive_feedback ?? 0}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-muted/40">
              <span className="text-xs text-muted-foreground block">Negative Feedback</span>
              <span className="font-bold text-destructive flex items-center gap-1 text-base">
                <ThumbsDown className="w-3.5 h-3.5" /> {ad.user?.negative_feedback ?? 0}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-muted/40">
              <span className="text-xs text-muted-foreground block">
                {rawType === 'SELL' ? 'Avg Release Time' : 'Avg Pay Time'}
              </span>
              <span className="font-bold text-foreground text-base">
                {rawType === 'SELL' ? avgReleaseText : avgPayText}
              </span>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
