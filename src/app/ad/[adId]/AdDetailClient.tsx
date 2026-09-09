'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, AlertCircle, ArrowRightLeft, Clock, CheckCircle2, Lock, ThumbsUp, ThumbsDown, CheckCircle } from 'lucide-react';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
import { FlagIcon } from '@/components/ui/flag-icon';
import { createTradeOrderWithEscrow } from '@/app/ad/actions';
import { getUserPresenceStatus, formatJoinedDate, getDisplayUsername } from '@/lib/utils/timeFormatter';
import { usePrices } from '@/context/price-context';
import { supabase } from '@/lib/supabase/client';
import TraderStatusBadge from '@/components/TraderStatusBadge';
import { cn } from '@/lib/utils';

// Crypto SVG Icon Helper
function CryptoSvgIcon({ coin, className = "h-5 w-5" }: { coin: string; className?: string }) {
  const c = (coin || 'BTC').toUpperCase();
  switch (c) {
    case 'BTC': return <BtcLogo className={className} />;
    case 'ETH': return <EthLogo className={className} />;
    case 'LTC': return <LtcLogo className={className} />;
    case 'USDT': return <UsdtLogo className={className} />;
    default:
      return (
        <span className={cn("inline-flex items-center justify-center rounded-full bg-amber-500/20 text-amber-600 dark:text-amber-400 font-bold text-xs font-mono px-1.5 py-0.5", className)}>
          {c.slice(0, 3)}
        </span>
      );
  }
}

// Fiat to Country code map for FlagIcon
const FIAT_TO_COUNTRY: Record<string, string> = {
  USD: 'us',
  EUR: 'eu',
  GBP: 'gb',
  INR: 'in',
  CAD: 'ca',
  AUD: 'au',
  JPY: 'jp',
  CNY: 'cn',
  BRL: 'br',
  AED: 'ae',
  NGN: 'ng',
  RUB: 'ru',
  TRY: 'tr',
  PKR: 'pk',
  BDT: 'bd',
  SGD: 'sg',
  VND: 'vn',
  PHP: 'ph',
  IDR: 'id',
  THB: 'th',
  MYR: 'my',
  ZAR: 'za',
  KES: 'ke',
  GHS: 'gh',
  EGP: 'eg',
  COP: 'co',
  ARS: 'ar',
  MXN: 'mx',
};

function FiatFlagBadge({ fiat, className }: { fiat: string; className?: string }) {
  const f = (fiat || 'USD').toUpperCase();
  const country = FIAT_TO_COUNTRY[f] || 'us';
  return (
    <div className={cn("inline-flex items-center gap-1.5", className)}>
      <FlagIcon countryCode={country} className="w-4 h-3 rounded-xs object-cover shrink-0" />
      <span className="font-bold text-foreground text-sm font-mono">{f}</span>
    </div>
  );
}

export function AdDetailClient({ ad, currentUserId }: { ad: any; currentUserId?: string }) {
  const router = useRouter();
  const { prices, fiatRates } = usePrices();

  const [fiatAmount, setFiatAmount] = useState<string>('');
  const [cryptoAmount, setCryptoAmount] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Live presence and trader profile state fetched directly from Supabase
  const [liveProfile, setLiveProfile] = useState<any>(
    Array.isArray(ad.profiles) ? ad.profiles[0] : ad.profiles || ad.user || null
  );

  const isOwnAd = Boolean(currentUserId && ad.user_id && currentUserId === ad.user_id);
  const isAdSell = (ad.type || ad.ad_type || ad.adType || 'SELL').toUpperCase() === 'SELL';
  
  // Dynamic Escrow Fee
  const ESCROW_FEE_PERCENT = 1.5;

  const cryptoCode = (ad.asset_symbol || ad.crypto || ad.coin || 'BTC').toUpperCase();
  const fiatCode = (ad.fiat_symbol || ad.fiat || ad.fiat_currency || ad.fiatCurrency || 'USD').toUpperCase();

  // 1. Unit Price set by Advertiser
  const rawPrice = Number(ad.price ?? ad.unit_price ?? (typeof ad.fixed_rate === 'number' ? ad.fixed_rate : undefined) ?? (typeof ad.fixedRate === 'number' ? ad.fixedRate : undefined));
  const unitPrice = rawPrice > 0 ? rawPrice : 80116.02;

  // Compute live market price in target fiat
  const marketPriceUsd = prices[cryptoCode] || 0;
  const exchangeRate = fiatRates[fiatCode] || 1;
  const currentMarketPriceInFiat = marketPriceUsd * exchangeRate;
  const marketDiffPercent = currentMarketPriceInFiat > 0 
    ? ((unitPrice - currentMarketPriceInFiat) / currentMarketPriceInFiat) * 100 
    : 0;

  // 2. Configured Limits
  const minLimit = Number(ad.min_limit ?? ad.min_amount ?? ad.minAmount ?? 100) || 100;
  const maxLimit = Number(ad.max_limit ?? ad.max_amount ?? ad.maxAmount ?? 5000) || 5000;

  // 3. Real-time dynamic available limit
  const creatorCryptoBalance = Number(ad.creator_crypto_balance ?? ad.total_amount ?? ad.crypto_amount ?? 1.5);
  const creatorMaxFiat = creatorCryptoBalance > 0 && unitPrice > 0 ? creatorCryptoBalance * unitPrice : maxLimit;
  const availableMaxLimit = isAdSell ? Math.min(maxLimit, Math.max(minLimit, creatorMaxFiat)) : maxLimit;

  // 4. Payment window (Platform options: 30, 60, 90, 120 minutes)
  const rawPaymentWindow = Number(
    ad.payment_window ?? 
    ad.payment_time_limit ?? 
    ad.paymentTimeLimit ?? 
    ad.paymentWindow ?? 
    ad.payment_time ?? 
    ad.time_limit
  );
  const paymentWindowMinutes = rawPaymentWindow && rawPaymentWindow >= 30 ? rawPaymentWindow : 30;

  // Amount validation for Buy/Sell button
  const enteredFiat = parseFloat(fiatAmount);
  const isAmountEntered = !isNaN(enteredFiat) && enteredFiat > 0;
  const isAmountWithinLimits = isAmountEntered && enteredFiat >= minLimit && enteredFiat <= availableMaxLimit;
  const isButtonDisabled = isSubmitting || isOwnAd || !isAmountWithinLimits;

  // Fetch live trader profile data from Supabase on mount
  useEffect(() => {
    const sellerId = ad.user_id || ad.userId;
    if (!sellerId) return;

    let isMounted = true;
    async function fetchLiveTraderProfile() {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', sellerId)
          .maybeSingle();

        if (!error && data && isMounted) {
          setLiveProfile((prev: any) => ({ ...prev, ...data }));
        }
      } catch (err) {
        console.warn('Could not fetch live trader profile from Supabase:', err);
      }
    }

    fetchLiveTraderProfile();
    return () => { isMounted = false; };
  }, [ad.user_id, ad.userId]);

  // Handle Synchronized Inputs
  const handleFiatChange = (val: string) => {
    setFiatAmount(val);
    const num = parseFloat(val);
    if (!isNaN(num) && unitPrice > 0) {
      setCryptoAmount((num / unitPrice).toFixed(6));
    } else {
      setCryptoAmount('');
    }
  };

  const handleCryptoChange = (val: string) => {
    setCryptoAmount(val);
    const num = parseFloat(val);
    if (!isNaN(num)) {
      setFiatAmount((num * unitPrice).toFixed(2));
    } else {
      setFiatAmount('');
    }
  };

  // Escrow Calculations
  const numCrypto = parseFloat(cryptoAmount) || 0;
  // If isAdSell: User is Buying (0% fee for user). If ad is BUY: User is Selling (1.5% fee charged to user)
  const isUserSelling = !isAdSell;
  const escrowFeeCrypto = isUserSelling ? Number(((numCrypto * ESCROW_FEE_PERCENT) / 100).toFixed(6)) : 0;
  const totalSellerCryptoRequired = Number((numCrypto + escrowFeeCrypto).toFixed(6));

  // Trader Presence & Relative Time
  const profile = liveProfile || (Array.isArray(ad.profiles) ? ad.profiles[0] : ad.profiles || ad.user);
  const lastActiveTimestamp = profile?.last_seen_at || profile?.last_seen || profile?.lastActive || profile?.updated_at;
  const relativeJoined = formatJoinedDate(profile?.created_at || ad.created_at);
  const traderUsername = getDisplayUsername(ad) || profile?.username || 'Trader';

  // Trader Statistics & Avg Release/Pay Time based on trade direction
  const positiveCount = Number(profile?.positive_feedback ?? ad.positive_feedback ?? 0);
  const negativeCount = Number(profile?.negative_feedback ?? ad.negative_feedback ?? 0);
  const completedTrades = Number(
    profile?.total_completed_trades ??
    profile?.completed_trades ?? 
    ad.sellerStats?.completedTrades ?? 
    ad.completed_trades ?? 
    0
  );
  const totalFeedback = positiveCount + negativeCount;
  const positiveRatio = totalFeedback > 0 ? ((positiveCount / totalFeedback) * 100).toFixed(1) : '100.0';

  // Average time logic: Support avg_payment_time_mins, avg_release_time_mins, avg_release_minutes, avg_payment_minutes, etc.
  const rawAvgRelease = Number(
    profile?.avg_release_time_mins ??
    profile?.avg_release_minutes ?? 
    profile?.avg_release_time ?? 
    ad.sellerStats?.avgReleaseTime ?? 
    (ad.profiles ? (Array.isArray(ad.profiles) ? (ad.profiles[0]?.avg_release_time_mins ?? ad.profiles[0]?.avg_release_minutes) : (ad.profiles?.avg_release_time_mins ?? ad.profiles?.avg_release_minutes)) : undefined)
  );
  const rawAvgPay = Number(
    profile?.avg_payment_time_mins ??
    profile?.avg_payment_minutes ?? 
    profile?.avg_pay_time ?? 
    (ad.profiles ? (Array.isArray(ad.profiles) ? (ad.profiles[0]?.avg_payment_time_mins ?? ad.profiles[0]?.avg_payment_minutes) : (ad.profiles?.avg_payment_time_mins ?? ad.profiles?.avg_payment_minutes)) : undefined)
  );
  const hasAvgRelease = Number.isFinite(rawAvgRelease) && rawAvgRelease > 0;
  const hasAvgPay = Number.isFinite(rawAvgPay) && rawAvgPay > 0;
  const avgTimeDisplay = isAdSell
    ? (hasAvgRelease ? `${rawAvgRelease.toFixed(1)}m` : 'N/A')
    : (hasAvgPay ? `${rawAvgPay.toFixed(1)}m` : 'N/A');

  const paymentMethodsList: string[] = Array.isArray(ad.payment_methods)
    ? ad.payment_methods
    : Array.isArray(ad.paymentMethods)
    ? ad.paymentMethods
    : typeof ad.payment_methods === 'string'
    ? JSON.parse(ad.payment_methods || '[]')
    : ['Bank Transfer'];

  const offerTagsList: string[] = Array.isArray(ad.ad_tags)
    ? ad.ad_tags
    : Array.isArray(ad.tags)
    ? ad.tags
    : typeof ad.ad_tags === 'string'
    ? JSON.parse(ad.ad_tags || '[]')
    : [];

  const handleInitiateTrade = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    if (isOwnAd) {
      setErrorMsg('You cannot initiate a trade on your own advertisement.');
      return;
    }

    const amt = Number(fiatAmount);
    if (!amt || isNaN(amt) || amt < minLimit || amt > availableMaxLimit) {
      setErrorMsg(`Trade amount must be between ${minLimit.toLocaleString()} and ${availableMaxLimit.toLocaleString()} ${fiatCode}.`);
      return;
    }

    setIsSubmitting(true);
    try {
      const cleanAdId = String(ad.public_ad_id || ad.public_id || ad.id || '').replace(/^#/, '').trim();
      const res = await createTradeOrderWithEscrow({ adId: cleanAdId, fiatAmount: amt });
      if (res.error) {
        setErrorMsg(res.error.message);
        setIsSubmitting(false);
        return;
      }
      if (res.data?.orderId) {
        router.push(`/trade/${res.data.orderId}`);
      } else {
        router.push('/trade');
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'An unexpected error occurred.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-6">
      {/* Top Header: Buy/Sell ₿ BTC with USD (Coin SVG Icon + short name + fiat short name only, no fiat icon) */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <ArrowRightLeft className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground flex items-center gap-2 flex-wrap">
              <span>{isAdSell ? 'Buy' : 'Sell'}</span>
              <CryptoSvgIcon coin={cryptoCode} className="h-6 w-6 inline-block shrink-0" />
              <span className="font-mono">{cryptoCode}</span>
              <span className="text-muted-foreground font-semibold">with</span>
              <span className="font-mono">{fiatCode}</span>
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Advertisement #{ad.id ? String(ad.id).substring(0, 8) : ''} • Protected by PaxOnes Escrow
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href={isAdSell ? '/buy' : '/sell'}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to {isAdSell ? 'Buy Crypto' : 'Sell Crypto'}
          </Link>
        </div>
      </div>

      {/* Three Column List Layout (Desktop: 3 Columns, Mobile: Stacked) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* ========================================================= */}
        {/* COLUMN 1: Trade Amount & Action Form                      */}
        {/* ========================================================= */}
        <div className="bg-card text-card-foreground border border-border rounded-2xl p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-border/80">
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
              <CryptoSvgIcon coin={cryptoCode} className="h-5 w-5 shrink-0" />
              <span>{isAdSell ? 'Buy' : 'Sell'} {cryptoCode}</span>
            </h2>
            <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-primary/10 text-primary border border-primary/20 flex items-center gap-1">
              <Lock className="w-3 h-3" /> 1.5% Escrow Fee
            </span>
          </div>

          {errorMsg && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 text-destructive text-xs rounded-xl flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {isOwnAd && (
            <div className="p-3 bg-amber-500/10 border border-amber-500/20 text-amber-600 dark:text-amber-400 text-xs rounded-xl flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>This is your own advertisement. You can view it, but you cannot open a trade against yourself.</span>
            </div>
          )}

          <form onSubmit={handleInitiateTrade} className="space-y-4">
            {/* Input Box 1: Depending on Buy or Sell */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                {isAdSell ? 'I Want to Pay' : 'I Will Pay'}
              </label>
              <div className="relative flex items-center">
                <input
                  type="number"
                  step="any"
                  value={isAdSell ? fiatAmount : cryptoAmount}
                  onChange={(e) => isAdSell ? handleFiatChange(e.target.value) : handleCryptoChange(e.target.value)}
                  placeholder={isAdSell ? `${minLimit.toLocaleString()} - ${availableMaxLimit.toLocaleString()}` : "0.000000"}
                  className="w-full bg-muted/40 border border-border rounded-xl pl-3.5 pr-28 py-2.5 text-foreground font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                />
                <div className="absolute right-3 pointer-events-none flex items-center gap-1.5">
                  {isAdSell ? (
                    <FiatFlagBadge fiat={fiatCode} />
                  ) : (
                    <div className="flex items-center gap-1.5">
                      <CryptoSvgIcon coin={cryptoCode} className="h-4 w-4" />
                      <span className="font-bold text-foreground text-sm font-mono">{cryptoCode}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Input Box 2: Depending on Buy or Sell */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                {isAdSell ? 'I Want to Receive' : 'I Want to Receive'}
              </label>
              <div className="relative flex items-center">
                <input
                  type="number"
                  step="any"
                  value={isAdSell ? cryptoAmount : fiatAmount}
                  onChange={(e) => isAdSell ? handleCryptoChange(e.target.value) : handleFiatChange(e.target.value)}
                  placeholder={isAdSell ? "0.000000" : `${minLimit.toLocaleString()} - ${availableMaxLimit.toLocaleString()}`}
                  className="w-full bg-muted/40 border border-border rounded-xl pl-3.5 pr-28 py-2.5 text-foreground font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                />
                <div className="absolute right-3 pointer-events-none flex items-center gap-1.5">
                  {isAdSell ? (
                    <div className="flex items-center gap-1.5">
                      <CryptoSvgIcon coin={cryptoCode} className="h-4 w-4" />
                      <span className="font-bold text-foreground text-sm font-mono">{cryptoCode}</span>
                    </div>
                  ) : (
                    <FiatFlagBadge fiat={fiatCode} />
                  )}
                </div>
              </div>
            </div>

            {/* Escrow Breakdown Box (Without the removed text) */}
            <div className="p-3.5 bg-muted/30 rounded-xl border border-border/60 space-y-2 text-xs">
              <div className="flex justify-between text-muted-foreground">
                <span>Escrow Fee ({isUserSelling ? '1.5%' : '0%'}):</span>
                <span className="font-mono text-foreground font-medium">
                  {escrowFeeCrypto.toFixed(6)} {cryptoCode}
                </span>
              </div>
              {isUserSelling && (
                <div className="flex justify-between text-muted-foreground pt-1.5 border-t border-border/80 font-medium">
                  <span>Total Seller Crypto Locked:</span>
                  <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                    {totalSellerCryptoRequired.toFixed(6)} {cryptoCode}
                  </span>
                </div>
              )}
            </div>

            {isAmountEntered && !isAmountWithinLimits && (
              <div className="p-2.5 bg-destructive/10 border border-destructive/20 text-destructive text-xs rounded-xl flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>
                  {enteredFiat < minLimit
                    ? `Amount is below minimum limit (${minLimit.toLocaleString()} ${fiatCode})`
                    : `Amount exceeds available limit (${availableMaxLimit.toLocaleString()} ${fiatCode})`}
                </span>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isButtonDisabled}
              className={`w-full py-3 px-4 rounded-xl font-bold text-sm text-white transition-all shadow-sm ${
                isAdSell
                  ? 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700'
                  : 'bg-rose-600 hover:bg-rose-500 active:bg-rose-700'
              } disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer`}
            >
              {isSubmitting ? (
                'Verifying & Initiating Escrow...'
              ) : (
                `${isAdSell ? 'Buy' : 'Sell'} ${cryptoCode}`
              )}
            </button>
          </form>
        </div>

        {/* ========================================================= */}
        {/* COLUMN 2: Pricing & Limits                                */}
        {/* ========================================================= */}
        <div className="bg-card text-card-foreground border border-border rounded-2xl p-6 shadow-sm space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            <h2 className="text-base font-bold text-foreground pb-3 border-b border-border/80">
              Pricing & Limits
            </h2>

            {/* Unit Price (Set by Advertiser) + Percent from Market Price */}
            <div className="p-3.5 bg-muted/30 rounded-xl border border-border/60 space-y-1.5">
              <span className="text-xs text-muted-foreground block font-medium">
                Unit Price (Set by Advertiser)
              </span>
              <div className="flex items-baseline gap-2 flex-wrap">
                <p className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                  {unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                  <span className="text-sm font-bold text-muted-foreground">{fiatCode}/{cryptoCode}</span>
                </p>
                {currentMarketPriceInFiat > 0 && (
                  <span className={`text-xs px-2 py-0.5 rounded-full font-bold border ${
                    marketDiffPercent >= 0 
                      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/25' 
                      : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/25'
                  }`}>
                    {marketDiffPercent >= 0 ? '+' : ''}{marketDiffPercent.toFixed(2)}% {marketDiffPercent >= 0 ? 'above' : 'below'} market
                  </span>
                )}
              </div>
              <span className="text-[11px] text-muted-foreground block">
                {ad.rate_type === 'fixed' || ad.pricing_type === 'FIXED' ? 'Fixed price set by advertiser' : `Floating rate with ${(ad.margin_percentage || ad.rate_percent || 0)}% margin`}
              </span>
            </div>

            {/* Order Limits */}
            <div className="p-3.5 bg-muted/30 rounded-xl border border-border/60">
              <span className="text-xs text-muted-foreground block mb-1 font-medium">
                Order Limits
              </span>
              <p className="text-sm font-bold text-foreground font-mono">
                {minLimit.toLocaleString()} – {maxLimit.toLocaleString()} {fiatCode}
              </p>
            </div>

            {/* Real-Time Available Limit */}
            <div className="p-3.5 bg-muted/30 rounded-xl border border-border/60">
              <span className="text-xs text-muted-foreground block mb-1 font-medium">
                Real-Time Available Limit
              </span>
              <p className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 font-mono">
                {minLimit.toLocaleString()} – {availableMaxLimit.toLocaleString()} {fiatCode}
              </p>
              <span className="text-[11px] text-muted-foreground mt-0.5 block">
                {isAdSell ? "Capped by advertiser's verified available crypto balance" : "Subject to advertiser's buying capacity"}
              </span>
            </div>

            {/* Payment Time Limit */}
            <div className="p-3.5 bg-muted/30 rounded-xl border border-border/60 flex items-center justify-between">
              <div>
                <span className="text-xs text-muted-foreground block font-medium">Payment Window</span>
                <p className="text-xs font-semibold text-foreground mt-0.5">{paymentWindowMinutes} minutes</p>
              </div>
              <Clock className="h-5 w-5 text-muted-foreground" />
            </div>
          </div>

          <div className="pt-3 border-t border-border/80 text-[11px] text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>Funds are securely escrowed upon trade initiation.</span>
          </div>
        </div>

        {/* ========================================================= */}
        {/* COLUMN 3: Trader Information                              */}
        {/* ========================================================= */}
        <div className="bg-card text-card-foreground border border-border rounded-2xl p-6 shadow-sm space-y-5">
          <h2 className="text-base font-bold text-foreground pb-3 border-b border-border/80">
            Trader Information
          </h2>

          {/* Trader Presence & Identity */}
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-full bg-primary/10 border border-border flex items-center justify-center font-black text-lg text-primary shrink-0">
              {traderUsername.charAt(0).toUpperCase()}
            </div>

            <div className="space-y-1 min-w-0">
              <div className="font-bold text-foreground text-sm flex items-center gap-1.5">
                <span className="truncate">{traderUsername}</span>
                <ShieldCheck className="w-4 h-4 text-emerald-500 shrink-0" />
                {profile?.country && <FlagIcon countryCode={profile.country} className="w-4 h-3 rounded-xs" />}
              </div>
              
              {/* Fetched current online/offline last seen detail from Supabase */}
              <div className="mt-0.5">
                <TraderStatusBadge presence={profile?.is_online ? 'Online' : undefined} lastActive={lastActiveTimestamp} />
              </div>

              <p className="text-[11px] text-muted-foreground">
                Joined {relativeJoined}
              </p>
            </div>
          </div>

          {/* Trader Statistics: Completed, Positive, Negative, Avg Release / Pay Time */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 py-3 px-3 bg-muted/30 rounded-xl border border-border/60 text-center">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Completed</p>
              <p className="text-xs font-bold text-foreground mt-0.5">{completedTrades}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Positive</p>
              <div className="flex items-center justify-center gap-0.5 text-emerald-600 dark:text-emerald-400 font-bold text-xs mt-0.5">
                <ThumbsUp className="h-3 w-3" />
                <span>{positiveCount}</span>
              </div>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Negative</p>
              <div className="flex items-center justify-center gap-0.5 text-rose-600 dark:text-rose-400 font-bold text-xs mt-0.5">
                <ThumbsDown className="h-3 w-3" />
                <span>{negativeCount}</span>
              </div>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">
                {isAdSell ? 'Avg. Release' : 'Avg. Pay'}
              </p>
              <p className="text-xs font-bold text-foreground mt-0.5">
                {avgTimeDisplay}
              </p>
            </div>
          </div>

          {/* Trade Information Section */}
          <div className="space-y-3 pt-2 border-t border-border/80">
            <div>
              <span className="text-xs font-semibold text-muted-foreground block mb-1.5">
                Accepted Payment Methods
              </span>
              <div className="flex flex-wrap gap-1.5">
                {paymentMethodsList.length > 0 ? (
                  paymentMethodsList.map((method, idx) => (
                    <span
                      key={idx}
                      className="px-2.5 py-1 bg-muted text-foreground text-xs font-medium rounded-lg border border-border"
                    >
                      {method}
                    </span>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">Bank Transfer</span>
                )}
              </div>
            </div>

            {offerTagsList.length > 0 && (
              <div>
                <span className="text-xs font-semibold text-muted-foreground block mb-1.5">
                  Offer Tags
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {offerTagsList.map((tag, idx) => (
                    <span
                      key={idx}
                      className="px-2 py-0.5 bg-primary/10 text-primary text-[11px] font-semibold rounded-md border border-primary/20"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div>
              <span className="text-xs font-semibold text-muted-foreground block mb-1">
                Terms & Conditions
              </span>
              <p className="text-xs bg-muted/30 p-3 rounded-xl text-muted-foreground leading-relaxed border border-border/60 whitespace-pre-line max-h-36 overflow-y-auto">
                {ad.terms || ad.instructions || 'No specific terms provided by advertiser.'}
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

export default AdDetailClient;

