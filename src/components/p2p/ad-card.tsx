'use client';

import React from 'react';
import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import type { P2PAd, CryptoCurrency } from '@/lib/types';
import { usePrices } from '@/context/price-context';
import { ThumbsUp, ThumbsDown, Info, Award, Clock, CheckCircle } from 'lucide-react';
import { cn, toDate } from '@/lib/utils';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo, DefaultAvatar } from '@/components/icons';
import { CurrencyIcon } from '@/components/CurrencyIcon';
import { FlagIcon } from '../ui/flag-icon';
import { MerchantBadge } from '@/components/merchant/merchant-badge';
import { formatDistanceToNow } from 'date-fns';
import { getPresenceStatus, formatJoinedDate, usePresenceStatus, resolveUserLastSeen } from '@/lib/presence';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from '../ui/scroll-area';

// 1. App-Specific Supported Cryptos (BTC, USDT, LTC, ETH)
const SUPPORTED_CRYPTO_ICONS: Record<string, string> = {
  BTC: '/icons/btc.svg',
  USDT: '/icons/usdt.svg',
  LTC: '/icons/ltc.svg',
  ETH: '/icons/eth.svg',
};

const CryptoLogo = ({ crypto, className }: { crypto: CryptoCurrency | string; className?: string }) => {
  const sym = String(crypto || 'LTC').toUpperCase();
  switch (sym) {
    case 'BTC': return <BtcLogo className={className} />;
    case 'ETH': return <EthLogo className={className} />;
    case 'LTC': return <LtcLogo className={className} />;
    case 'USDT': return <UsdtLogo className={className} />;
    default: return <CurrencyIcon symbol={sym} size="sm" showCode={false} />;
  }
};

const DetailRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className="flex justify-between items-start text-sm">
    <p className="text-muted-foreground">{label}</p>
    <div className="text-right font-medium max-w-[70%]">{value}</div>
  </div>
);

interface AdCardProps {
  ad: P2PAd | any;
  marketPriceUsd?: number;
  fiatExchangeRate?: number;
  onActionClick?: () => void;
}

export function AdCard({ ad, marketPriceUsd: propMarketPriceUsd, fiatExchangeRate: propFiatExchangeRate, onActionClick }: AdCardProps) {
  const { prices, fiatRates } = usePrices();
  const adCreator = ad.user || ad.profiles || ({} as any);

  // 1. Dynamic fiat & crypto currency resolution from Supabase fields
  const adFiat = (
    ad.fiat || 
    ad.fiatCurrency || 
    ad.fiat_currency || 
    ad.currency || 
    ad.fiat_symbol || 
    'PKR'
  ).toUpperCase();
  
  const adCrypto = (
    ad.crypto || 
    ad.cryptoSymbol || 
    ad.crypto_symbol || 
    ad.coin || 
    ad.asset || 
    ad.asset_symbol || 
    ad.crypto_currency || 
    'LTC'
  ).toUpperCase() as CryptoCurrency;

  // 2. Dynamic market price & pair-specific margin calculation (eliminating false -99.91% issues)
  const marketPriceUsd = propMarketPriceUsd ?? prices[adCrypto] ?? 0;
  const exchangeRate = propFiatExchangeRate ?? fiatRates[adFiat] ?? 1;
  const marketPriceInFiat = marketPriceUsd * exchangeRate;

  // Unit price set by seller/buyer fetched from Supabase
  const rawPrice = Number(ad.rate ?? ad.price ?? ad.unit_price ?? ad.customUnitPrice ?? ad.fixedRate ?? 0);
  const marginPercent = Number(ad.ratePercent ?? ad.margin_percentage ?? ad.price_margin_percent ?? 0);

  const adPrice = rawPrice > 0 
    ? rawPrice 
    : (marketPriceInFiat > 0 
        ? marketPriceInFiat * (1 + marginPercent / 100) 
        : 0);

  const pricePremium = marketPriceInFiat > 0 && adPrice > 0 
    ? (adPrice - marketPriceInFiat) / marketPriceInFiat 
    : 0;
  
  const isAdTypeBuy = String(ad.adType || ad.type || ad.ad_type || 'SELL').toUpperCase() === 'BUY';
  const isForBuyingPage = !isAdTypeBuy;
  
  const marginBadgeText = marketPriceInFiat > 0 && adPrice > 0
    ? `${pricePremium >= 0 ? '+' : ''}${(pricePremium * 100).toFixed(2)}%`
    : null;

  const priceBadgeClass = pricePremium >= 0 
    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' 
    : 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300';

  const buttonLabel = isAdTypeBuy ? 'Sell' : 'Buy';
  const buttonColorClass = buttonLabel === 'Buy'
    ? 'bg-green-600 hover:bg-green-700 text-white'
    : 'bg-red-600 hover:bg-red-700 text-white';

  // 3. Online Status / Last Seen formatting from Supabase
  const userLastSeen = resolveUserLastSeen(adCreator);
  const userCreatedAt = adCreator?.created_at || adCreator?.createdAt;
  const presence = usePresenceStatus(userLastSeen, 15000);
  const joinedText = formatJoinedDate(userCreatedAt);

  const isUserOnline = presence.isOnline;
  
  const userBadges = (adCreator?.badges || []);
  const displayedBadges = userBadges.slice(0, 3);
  const hiddenBadgesCount = userBadges.length - displayedBadges.length;

  const rawPayTime = Number(
    adCreator?.avg_payment_time_mins ?? 
    adCreator?.avgPayTime ?? 
    adCreator?.avg_payment_minutes ?? 
    adCreator?.avg_pay_time
  );
  const rawReleaseTime = Number(
    adCreator?.avg_release_time_mins ?? 
    adCreator?.avgReleaseTime ?? 
    adCreator?.avg_release_minutes ?? 
    adCreator?.avg_release_time
  );
  const hasValidPayTime = Number.isFinite(rawPayTime) && rawPayTime > 0;
  const hasValidReleaseTime = Number.isFinite(rawReleaseTime) && rawReleaseTime > 0;
  const configuredPaymentWindow = Number(
    (ad as any).payment_window_minutes ??
    (ad as any).payment_time_limit ?? 
    (ad as any).paymentTimeLimit ?? 
    (ad as any).payment_window ?? 
    (ad as any).paymentWindow ?? 
    30
  ) || 30;

  // Limits calculation with explicit inventory-to-fiat conversion
  const minLimit = Number(ad.minAmount ?? (ad as any).minLimit ?? (ad as any).min_amount ?? (ad as any).min_limit ?? 0);
  const maxLimit = Number(ad.maxAmount ?? (ad as any).maxLimit ?? (ad as any).max_amount ?? (ad as any).max_limit ?? 0);

  // If available crypto inventory is passed (token amount), calculate available fiat using unit price:
  // Max Limit (Fiat) = Available Crypto * Unit Price
  let availableFiatFromInventory = Infinity;
  const rawAvailableCrypto = (ad as any).available_crypto ?? (ad as any).availableCrypto ?? (ad as any).available_tokens ?? (ad as any).crypto_inventory;
  if (rawAvailableCrypto !== undefined && rawAvailableCrypto !== null && Number(rawAvailableCrypto) >= 0) {
    const availCryptoNum = Number(rawAvailableCrypto);
    availableFiatFromInventory = availCryptoNum * (adPrice > 0 ? adPrice : 1);
  } else if (adCreator?.cryptoBalances && adCreator.cryptoBalances[adCrypto] !== undefined) {
    const availCryptoNum = Number(adCreator.cryptoBalances[adCrypto]);
    availableFiatFromInventory = availCryptoNum * (adPrice > 0 ? adPrice : 1);
  }

  // Check if advertiser balance was given in fiat or USD
  const rawAdvertiserBalanceUSD = Number((ad as any).advertiserBalanceUSD ?? (ad as any).creator_crypto_balance_fiat ?? 0);
  const advertiserBalanceInFiat = rawAdvertiserBalanceUSD > 0
    ? rawAdvertiserBalanceUSD * (adFiat === 'USD' ? 1 : (fiatRates[adFiat] || 1))
    : (availableFiatFromInventory < Infinity ? availableFiatFromInventory : maxLimit);

  // Effective max limit is capped by available inventory/balance
  const effectiveMaxLimit = maxLimit > 0
    ? (advertiserBalanceInFiat > 0 ? Math.min(maxLimit, advertiserBalanceInFiat) : maxLimit)
    : (advertiserBalanceInFiat > 0 ? advertiserBalanceInFiat : 0);

  const isAvailable = (effectiveMaxLimit >= minLimit) && (effectiveMaxLimit > 0 || maxLimit === 0);

  return (
    <Card className="hover:shadow-md transition-shadow">
      <div className="p-4 flex flex-col sm:flex-row justify-between items-start gap-4">
        {/* Left Side: User Info */}
        <div className="flex-grow space-y-3">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={adCreator?.photoURL || adCreator?.avatar_url} />
              <AvatarFallback><DefaultAvatar /></AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-1.5">
                <Link href={`/users/${adCreator?.username || 'Trader'}`} className="font-semibold hover:underline">
                  {adCreator?.username || 'Trader'}
                </Link>
                <MerchantBadge tier={adCreator?.merchant_tier || (ad as any)?.merchant_tier} size="sm" />
                {adCreator?.country && <FlagIcon countryCode={adCreator.country} />}
                {displayedBadges.map((badge, i) => (
                  <span
                    key={i}
                    title={badge}
                    className="inline-flex items-center justify-center p-1 rounded-md border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40"
                  >
                    <Award className="h-3 w-3 text-amber-500" />
                  </span>
                ))}
                {hiddenBadgesCount > 0 && <Badge variant="secondary">+{hiddenBadgesCount} more</Badge>}
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span>{adCreator?.total_completed_trades ?? adCreator?.completedTrades ?? adCreator?.completed_trades ?? adCreator?.tradesCount ?? 0} Trades</span>
                <div className="flex items-center gap-1">
                  <ThumbsUp className="h-3 w-3 text-green-500" /> {adCreator?.positiveFeedback || 0}
                </div>
                <div className="flex items-center gap-1">
                  <ThumbsDown className="h-3 w-3 text-red-500" /> {adCreator?.negativeFeedback || 0}
                </div>
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
            </div>
          </div>
          
          {ad.offerLabel && (
            <div className="p-2 text-sm font-semibold rounded-md bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200">
              {ad.offerLabel}
            </div>
          )}
          
          <div className="flex flex-wrap gap-1">
            {(ad.paymentMethods || []).map(pm => <Badge key={pm} variant="outline" className="text-xs">{pm}</Badge>)}
          </div>
          
          {ad.tags && ad.tags.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {ad.tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}
            </div>
          )}
        </div>
        
        {/* Right Side: Price & Action */}
        <div className="w-full sm:w-auto flex flex-col items-start sm:items-end gap-2">
          <div>
            <p className="text-xs text-muted-foreground">Price</p>
            {/* Dynamic Price Display */}
            <div className="flex items-center gap-2">
              <CryptoLogo crypto={adCrypto} className="h-5 w-5" />
              <div className="text-lg font-bold">
                {adPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}{' '}
                <span className="text-sm font-normal text-muted-foreground">{adFiat} / {adCrypto}</span>
              </div>
              {marketPriceInFiat > 0 && (
                <Badge className={cn('font-semibold', priceBadgeClass)}>
                  {pricePremium >= 0 ? '+' : ''}{(pricePremium * 100).toFixed(2)}%
                </Badge>
              )}
            </div>
          </div>

          <div>
            {/* Dynamic Limits Display */}
            {isAvailable ? (
              <div className="text-sm text-muted-foreground">
                Limits: <span className="font-medium text-foreground">{minLimit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} - {effectiveMaxLimit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {adFiat}</span>
              </div>
            ) : (
              <p className="font-semibold text-xs text-red-500">
                Insufficient Advertiser Balance
              </p>
            )}
          </div>

          <div className="flex items-center justify-end gap-1 sm:gap-2 mt-2 w-full sm:w-auto">
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="icon" className="h-9 w-9">
                  <Info className="h-5 w-5" />
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle className="text-xl font-bold">
                    {isAdTypeBuy ? `Sell Ad to ${adCreator?.username || 'Trader'}` : `Buy Ad from ${adCreator?.username || 'Trader'}`}
                  </DialogTitle>
                  <DialogDescription>
                    {isAdTypeBuy ? `Sell to ${adCreator?.username || 'Trader'}` : `Buy from ${adCreator?.username || 'Trader'}`}
                  </DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[70vh]">
                  <div className="space-y-6 py-4 pr-6">
                    <div>
                      <h4 className="font-semibold text-base mb-2">Trader Info</h4>
                      <div className="space-y-2 text-sm p-3 border rounded-md bg-secondary/50">
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={adCreator?.photoURL || adCreator?.avatar_url} />
                            <AvatarFallback><DefaultAvatar /></AvatarFallback>
                          </Avatar>
                          <div>
                            <p className="font-semibold">{adCreator?.username || 'Trader'}</p>
                            <p className="text-xs text-muted-foreground">{formatJoinedDate(adCreator?.created_at || adCreator?.createdAt)}</p>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-y-2 gap-x-4 pt-2">
                          <div className="flex items-center gap-2">
                            <CheckCircle className="h-4 w-4 text-muted-foreground" /> 
                            <span>{adCreator?.total_completed_trades ?? adCreator?.completedTrades ?? adCreator?.completed_trades ?? adCreator?.tradesCount ?? 0} Trades</span>
                          </div>
                          <div className="flex items-center gap-2"><ThumbsUp className="h-4 w-4 text-green-500" /> <span>{adCreator?.positiveFeedback || 0}</span></div>
                          <div className="flex items-center gap-2"><ThumbsDown className="h-4 w-4 text-red-500" /> <span>{adCreator?.negativeFeedback || 0}</span></div>
                          <div className="flex items-center gap-2">
                            <Clock className="h-4 w-4 text-muted-foreground" />
                            <span>
                              {isAdTypeBuy
                                ? (hasValidPayTime ? `${rawPayTime.toFixed(1)}m pay` : 'N/A')
                                : (hasValidReleaseTime ? `${rawReleaseTime.toFixed(1)}m release` : 'N/A')}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-base mb-2">Ad Info</h4>
                      <div className="space-y-3 text-sm p-3 border rounded-md bg-secondary/50">
                        <DetailRow label="Price" value={<div className="flex items-center gap-2">{adPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<span className="text-muted-foreground">{adFiat} / {adCrypto}</span></div>} />
                        <DetailRow label="Limits" value={`${minLimit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} - ${effectiveMaxLimit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${adFiat}`} />
                        <DetailRow label="Payment Window" value={`${configuredPaymentWindow} minutes`} />
                        <DetailRow label="Payment Methods" value={<div className="flex flex-wrap gap-1 justify-end">{(ad.paymentMethods || []).map(pm => <Badge key={pm} variant="outline">{pm}</Badge>)}</div>} />
                      </div>
                      <div className="space-y-2 text-sm p-3 border rounded-md bg-secondary/50 mt-2">
                        <p className="font-medium">Terms & Conditions</p>
                        <p className="text-muted-foreground whitespace-pre-wrap">{ad.terms || 'No specific terms provided.'}</p>
                      </div>
                      {ad.tags && ad.tags.length > 0 && (
                        <div className="space-y-2 text-sm p-3 border rounded-md bg-secondary/50 mt-2">
                          <p className="font-medium">Tags</p>
                          <div className="flex flex-wrap gap-1">{ad.tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </ScrollArea>
              </DialogContent>
            </Dialog>

            {onActionClick ? (
              <Button onClick={onActionClick} className={cn(buttonColorClass, "gap-2")}>
                {buttonLabel} <CryptoLogo crypto={adCrypto} className="h-4 w-4" />
              </Button>
            ) : (
              <Button asChild className={cn(buttonColorClass, "gap-2")}>
                <Link href={`/ad/${ad.id}`}>
                  {buttonLabel} <CryptoLogo crypto={adCrypto} className="h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
