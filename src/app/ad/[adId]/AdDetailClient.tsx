'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ShieldCheck, AlertCircle, ArrowRightLeft, Clock, CheckCircle2, Lock } from 'lucide-react';
import { CurrencyIcon } from '@/components/CurrencyIcon';
import { createTradeOrderWithEscrow } from '@/app/ad/actions';
import { getUserPresenceStatus, formatJoinedDate, getDisplayUsername } from '@/lib/utils/timeFormatter';

export function AdDetailClient({ ad, currentUserId }: { ad: any; currentUserId?: string }) {
  const router = useRouter();
  const [fiatAmount, setFiatAmount] = useState<string>('');
  const [cryptoAmount, setCryptoAmount] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isOwnAd = Boolean(currentUserId && ad.user_id && currentUserId === ad.user_id);
  const isAdSell = (ad.type || ad.ad_type || ad.adType || 'SELL').toUpperCase() === 'SELL';
  
  // Dynamic Escrow Fee
  const ESCROW_FEE_PERCENT = 1.5;

  // 1. Unit Price defined by advertiser (DO NOT replace with market price)
  const rawPrice = Number(ad.price || ad.unit_price || ad.fixed_rate || ad.fixedRate);
  const unitPrice = rawPrice > 0 ? rawPrice : 80116.02;

  // 2. Configured Limits
  const minLimit = Number(ad.min_limit ?? ad.min_amount ?? ad.minAmount ?? 100) || 100;
  const maxLimit = Number(ad.max_limit ?? ad.max_amount ?? ad.maxAmount ?? 5000) || 5000;

  // 3. Dynamic Available Limit
  // If SELL ad: advertiser's crypto balance in fiat terms vs max limit
  const creatorCryptoBalance = Number(ad.creator_crypto_balance ?? ad.total_amount ?? ad.crypto_amount ?? 1.5);
  const creatorMaxFiat = creatorCryptoBalance > 0 && unitPrice > 0 ? creatorCryptoBalance * unitPrice : maxLimit;
  const availableMaxLimit = isAdSell ? Math.min(maxLimit, Math.max(minLimit, creatorMaxFiat)) : maxLimit;

  const cryptoCode = (ad.asset_symbol || ad.crypto || 'USDT').toUpperCase();
  const fiatCode = (ad.fiat_symbol || ad.fiat || ad.fiat_currency || ad.fiatCurrency || 'USD').toUpperCase();

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
  const profile = Array.isArray(ad.profiles) ? ad.profiles[0] : ad.profiles || ad.user;
  const presence = getUserPresenceStatus(profile?.last_seen || ad.last_seen, profile?.is_online ?? ad.is_online);
  const relativeJoined = formatJoinedDate(profile?.created_at || ad.created_at);
  const traderUsername = getDisplayUsername(ad);

  // Trader Metrics
  const positiveCount = Number(ad.positive_feedback || profile?.positive_feedback || 0);
  const negativeCount = Number(ad.negative_feedback || profile?.negative_feedback || 0);
  const completedTrades = Number(ad.sellerStats?.completedTrades ?? ad.completed_trades ?? profile?.completed_trades ?? 0);
  const totalFeedback = positiveCount + negativeCount;
  const positiveRatio = totalFeedback > 0 ? ((positiveCount / totalFeedback) * 100).toFixed(1) : '100.0';

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
      const res = await createTradeOrderWithEscrow({ adId: ad.id, fiatAmount: amt });
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
      {/* Breadcrumb & Header Title */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary">
            <ArrowRightLeft className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-xl sm:text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
              {isAdSell ? 'Buy' : 'Sell'} <CurrencyIcon symbol={cryptoCode} size="md" /> with <CurrencyIcon symbol={fiatCode} size="md" />
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              Advertisement #{ad.id} • Automated Escrow Protection
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

      {/* Three Column Layout for Desktop / Stacked for Mobile */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        
        {/* ========================================================= */}
        {/* COLUMN 1: Trade Amount & Action Form                      */}
        {/* ========================================================= */}
        <div className="bg-card text-card-foreground border border-border rounded-2xl p-6 shadow-sm space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-border/80">
            <h2 className="text-base font-bold text-foreground flex items-center gap-2">
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
            {/* Fiat Input Field */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                {isAdSell ? 'I Want to Pay' : 'I Want to Receive'}
              </label>
              <div className="relative flex items-center">
                <input
                  type="number"
                  step="any"
                  value={fiatAmount}
                  onChange={(e) => handleFiatChange(e.target.value)}
                  placeholder={`${minLimit.toLocaleString()} - ${availableMaxLimit.toLocaleString()}`}
                  className="w-full bg-muted/40 border border-border rounded-xl pl-3.5 pr-24 py-2.5 text-foreground font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                />
                <div className="absolute right-3 pointer-events-none">
                  <CurrencyIcon symbol={fiatCode} size="sm" />
                </div>
              </div>
            </div>

            {/* Crypto Input Field */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1.5">
                {isAdSell ? 'I Will Receive' : 'I Will Pay'}
              </label>
              <div className="relative flex items-center">
                <input
                  type="number"
                  step="any"
                  value={cryptoAmount}
                  onChange={(e) => handleCryptoChange(e.target.value)}
                  placeholder="0.000000"
                  className="w-full bg-muted/40 border border-border rounded-xl pl-3.5 pr-28 py-2.5 text-foreground font-mono text-sm focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary transition-all"
                />
                <div className="absolute right-3 pointer-events-none">
                  <CurrencyIcon symbol={cryptoCode} size="sm" />
                </div>
              </div>
            </div>

            {/* Escrow Breakdown Box */}
            <div className="p-3.5 bg-muted/30 rounded-xl border border-border/60 space-y-1.5 text-xs">
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
              <p className="text-[11px] text-muted-foreground/80 italic pt-1">
                {isUserSelling
                  ? 'Real-time balance check ensures required crypto + 1.5% escrow fee are available.'
                  : 'Buyers pay 0% escrow fee.'}
              </p>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isSubmitting || isOwnAd}
              className={`w-full py-3 px-4 rounded-xl font-bold text-sm text-white transition-all shadow-sm ${
                isAdSell
                  ? 'bg-emerald-600 hover:bg-emerald-500 active:bg-emerald-700'
                  : 'bg-rose-600 hover:bg-rose-500 active:bg-rose-700'
              } disabled:opacity-50 disabled:cursor-not-allowed`}
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
        {/* COLUMN 2: Ad Limits & Pricing (Unit Price from Advertiser)*/}
        {/* ========================================================= */}
        <div className="bg-card text-card-foreground border border-border rounded-2xl p-6 shadow-sm space-y-5 flex flex-col justify-between">
          <div className="space-y-4">
            <h2 className="text-base font-bold text-foreground pb-3 border-b border-border/80">
              Pricing & Limits
            </h2>

            {/* Unit Price */}
            <div className="p-3.5 bg-muted/30 rounded-xl border border-border/60">
              <span className="text-xs text-muted-foreground block mb-1">
                Unit Price (Set by Advertiser)
              </span>
              <p className="text-2xl font-black font-mono text-emerald-600 dark:text-emerald-400">
                {unitPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                <span className="text-sm font-bold text-muted-foreground">{fiatCode}</span>
              </p>
              <span className="text-[11px] text-muted-foreground mt-0.5 block">
                Fixed rate determined by the advertiser
              </span>
            </div>

            {/* Configured Limit */}
            <div className="p-3.5 bg-muted/30 rounded-xl border border-border/60">
              <span className="text-xs text-muted-foreground block mb-1">
                Configured Order Limit
              </span>
              <p className="text-sm font-bold text-foreground">
                {minLimit.toLocaleString()} – {maxLimit.toLocaleString()} {fiatCode}
              </p>
            </div>

            {/* Real-time Available Limit */}
            <div className="p-3.5 bg-muted/30 rounded-xl border border-border/60">
              <span className="text-xs text-muted-foreground block mb-1">
                Real-Time Available Limit
              </span>
              <p className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400">
                {minLimit.toLocaleString()} – {availableMaxLimit.toLocaleString()} {fiatCode}
              </p>
              <span className="text-[11px] text-muted-foreground mt-0.5 block">
                Capped by advertiser's current available balance
              </span>
            </div>
          </div>

          <div className="pt-3 border-t border-border/80 text-[11px] text-muted-foreground flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
            <span>Funds are securely locked in smart escrow upon trade initiation.</span>
          </div>
        </div>

        {/* ========================================================= */}
        {/* COLUMN 3: Trade Information & Trader Details              */}
        {/* ========================================================= */}
        <div className="bg-card text-card-foreground border border-border rounded-2xl p-6 shadow-sm space-y-5">
          <h2 className="text-base font-bold text-foreground pb-3 border-b border-border/80">
            Trader Information
          </h2>

          {/* Trader Presence & Identity */}
          <div className="flex items-center gap-3.5">
            <div className="relative">
              <div className="w-12 h-12 rounded-full bg-primary/10 border border-border flex items-center justify-center font-black text-lg text-primary">
                {traderUsername.charAt(0).toUpperCase()}
              </div>
              <span
                className={`absolute bottom-0 right-0 w-3.5 h-3.5 rounded-full border-2 border-card ${presence.dotColor}`}
                title={presence.statusText}
              />
            </div>

            <div>
              <div className="font-bold text-foreground text-sm flex items-center gap-1.5">
                <span>{traderUsername}</span>
                <ShieldCheck className="w-4 h-4 text-emerald-500" />
              </div>
              <p className="text-xs text-muted-foreground mt-0.5 font-medium">
                {presence.statusText}
              </p>
              <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                Joined {relativeJoined}
              </p>
            </div>
          </div>

          {/* Trader Statistics */}
          <div className="grid grid-cols-3 gap-2 py-3 px-3 bg-muted/30 rounded-xl border border-border/60 text-center">
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Completed</p>
              <p className="text-xs font-bold text-foreground mt-0.5">{completedTrades}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Positive</p>
              <p className="text-xs font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">+{positiveCount}</p>
            </div>
            <div>
              <p className="text-[10px] text-muted-foreground uppercase font-semibold">Rating</p>
              <p className="text-xs font-bold text-foreground mt-0.5">{positiveRatio}%</p>
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
                      className="px-2.5 py-1 bg-muted/60 text-foreground text-xs font-medium rounded-lg border border-border"
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
                {ad.terms || ad.instructions || 'No additional terms provided by the advertiser.'}
              </p>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}

export default AdDetailClient;
