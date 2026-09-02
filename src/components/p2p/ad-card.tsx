'use client';

import Link from 'next/link';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import type { P2PAd, CryptoCurrency, User } from '@/lib/types';
import { usePrices } from '@/context/price-context';
import { ThumbsUp, ThumbsDown, Info, Award, Clock, Calendar, CheckCircle, User as UserIcon } from 'lucide-react';
import { cn, toDate } from '@/lib/utils';
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo, DefaultAvatar } from '@/components/icons';
import { FlagIcon } from '../ui/flag-icon';
import { formatDistanceToNow } from 'date-fns';
import { UserStatusIndicator } from '@/components/user-status';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ScrollArea } from '../ui/scroll-area';

const CryptoLogo = ({ crypto, className }: { crypto: CryptoCurrency; className?: string }) => {
    switch (crypto) {
        case 'BTC': return <BtcLogo className={className} />;
        case 'ETH': return <EthLogo className={className} />;
        case 'LTC': return <LtcLogo className={className} />;
        case 'USDT': return <UsdtLogo className={className} />;
        default: return null;
    }
}

const DetailRow = ({ label, value }: { label: string; value: React.ReactNode }) => (
    <div className="flex justify-between items-start text-sm">
      <p className="text-muted-foreground">{label}</p>
      <div className="text-right font-medium max-w-[70%]">{value}</div>
    </div>
);

interface AdCardProps {
  ad: P2PAd;
}

export function AdCard({ ad }: AdCardProps) {
  const { prices, fiatRates } = usePrices();
  const adCreator = ad.user;

  const marketPriceUsd = prices[ad.crypto] || 0;
  const exchangeRate = fiatRates[ad.fiatCurrency] || 1;
  const marketPriceInFiat = marketPriceUsd * exchangeRate;

  const adPrice =
    ad.rateType === 'fixed' ? ad.fixedRate! : marketPriceInFiat * (1 + (ad.ratePercent || 0) / 100);

  const pricePremium = marketPriceInFiat > 0 ? (adPrice - marketPriceInFiat) / marketPriceInFiat : 0;
  
  const isForBuyingPage = ad.adType === 'sell';
  
  const priceBadgeClass = isForBuyingPage 
    ? (pricePremium >= 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700') 
    : (pricePremium >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700');

  const buttonLabel = ad.adType === 'buy' ? 'Sell' : 'Buy';
  const buttonColorClass = buttonLabel === 'Buy'
    ? 'bg-green-600 hover:bg-green-700 text-white'
    : 'bg-red-600 hover:bg-red-700 text-white';

  const adCreatorLastActive = adCreator.lastActive ? toDate(adCreator.lastActive) : null;
  let activity = { text: 'Offline', dotClass: 'bg-gray-500', textClass: 'text-muted-foreground' };

  if (adCreatorLastActive) {
    const diffMinutes = (new Date().getTime() - adCreatorLastActive.getTime()) / (1000 * 60);
    const formattedDistance = formatDistanceToNow(adCreatorLastActive);

    if (diffMinutes < 5) {
      activity = { text: 'Active now', dotClass: 'bg-green-500', textClass: 'text-green-600' };
    } else if (diffMinutes < 60) {
      activity = { text: `${formattedDistance} ago`, dotClass: 'bg-green-500', textClass: 'text-green-600' };
    } else if (diffMinutes < 24 * 60) {
      activity = { text: `${formattedDistance} ago`, dotClass: 'bg-yellow-600', textClass: 'text-yellow-600' };
    } else {
      activity = { text: `${formattedDistance} ago`, dotClass: 'bg-gray-500', textClass: 'text-muted-foreground' };
    }
  }
  
  const userBadges = (adCreator.badges || []);
  const displayedBadges = userBadges.slice(0, 3);
  const hiddenBadgesCount = userBadges.length - displayedBadges.length;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <div className="p-4 flex flex-col sm:flex-row justify-between items-start gap-4">
        {/* Left Side: User Info */}
        <div className="flex-grow space-y-3">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={adCreator.photoURL} />
              <AvatarFallback><DefaultAvatar /></AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-1.5">
                <Link href={`/users/${adCreator.username}`} className="font-semibold hover:underline">{adCreator.username}</Link>
                {adCreator.country && <FlagIcon countryCode={adCreator.country} />}
                {displayedBadges.map((badge, i) => (
                   <Dialog key={i}>
                      <DialogTrigger asChild>
                         <Badge variant="outline" className="p-1 cursor-pointer"><Award className="h-3 w-3 text-amber-500" /></Badge>
                      </DialogTrigger>
                      <DialogContent className="sm:max-w-xs"><DialogHeader><DialogTitle>{badge}</DialogTitle></DialogHeader></DialogContent>
                   </Dialog>
                ))}
                {hiddenBadgesCount > 0 && <Badge variant="secondary">+{hiddenBadgesCount} more</Badge>}
              </div>
              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                <span>{adCreator.completedTrades || 0} Trades</span>
                <div className="flex items-center gap-1">
                  <ThumbsUp className="h-3 w-3 text-green-500" /> {adCreator.positiveFeedback || 0}
                </div>
                <div className="flex items-center gap-1">
                  <ThumbsDown className="h-3 w-3 text-red-500" /> {adCreator.negativeFeedback || 0}
                </div>
              </div>
              <div className="mt-1">
                <UserStatusIndicator lastActive={adCreator.lastActive} />
              </div>
            </div>
          </div>
          
          {ad.offerLabel && (
            <div className="p-2 text-sm font-semibold rounded-md bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200">
                {ad.offerLabel}
            </div>
          )}
          
          <div className="flex flex-wrap gap-1">
            {ad.paymentMethods.map(pm => <Badge key={pm} variant="outline" className="text-xs">{pm}</Badge>)}
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
            <div className="flex items-center gap-2">
              <CryptoLogo crypto={ad.crypto as CryptoCurrency} className="h-5 w-5" />
              <p className="font-bold text-lg">
                {adPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                <span className="text-sm text-muted-foreground ml-1">{ad.fiatCurrency}</span>
              </p>
              {marketPriceInFiat > 0 && (
                  <Badge className={cn('font-semibold', priceBadgeClass)}>
                      {pricePremium >= 0 ? '+' : ''}{(pricePremium * 100).toFixed(2)}%
                  </Badge>
              )}
            </div>
          </div>

          <div>
            <p className="text-xs text-muted-foreground">Limits</p>
            <p className="font-medium text-sm">{ad.minAmount.toLocaleString()} - {ad.maxAmount.toLocaleString()} {ad.fiatCurrency}</p>
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
                  <DialogTitle>Trade Details</DialogTitle>
                  <DialogDescription>
                    {ad.adType === 'buy' ? 'Buy' : 'Sell'} ad from {adCreator.username}
                  </DialogDescription>
                </DialogHeader>
                <ScrollArea className="max-h-[70vh]">
                  <div className="space-y-6 py-4 pr-6">
                    <div>
                      <h4 className="font-semibold text-base mb-2">Trader Info</h4>
                      <div className="space-y-2 text-sm p-3 border rounded-md bg-secondary/50">
                          <div className="flex items-center gap-3">
                            <Avatar className="h-10 w-10">
                                  <AvatarImage src={adCreator.photoURL} />
                                  <AvatarFallback><DefaultAvatar /></AvatarFallback>
                              </Avatar>
                              <div>
                                  <p className="font-semibold">{adCreator.username}</p>
                                  <p className="text-xs text-muted-foreground">Joined {adCreator.createdAt ? formatDistanceToNow(toDate(adCreator.createdAt)!) + ' ago' : 'N/A'}</p>
                              </div>
                          </div>
                          <div className="grid grid-cols-2 gap-y-2 gap-x-4 pt-2">
                            <div className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-muted-foreground" /> <span>{adCreator.completedTrades || 0} Trades</span></div>
                            <div className="flex items-center gap-2"><ThumbsUp className="h-4 w-4 text-green-500" /> <span>{adCreator.positiveFeedback || 0}</span></div>
                            <div className="flex items-center gap-2"><ThumbsDown className="h-4 w-4 text-red-500" /> <span>{adCreator.negativeFeedback || 0}</span></div>
                            <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /> <span>{(adCreator.avgReleaseTime || 0).toFixed(1)}m release</span></div>
                          </div>
                      </div>
                    </div>
                    <div>
                      <h4 className="font-semibold text-base mb-2">Ad Info</h4>
                      <div className="space-y-3 text-sm p-3 border rounded-md bg-secondary/50">
                          <DetailRow label="Price" value={<div className="flex items-center gap-2">{adPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<span className="text-muted-foreground">{ad.fiatCurrency} / {ad.crypto}</span></div>} />
                          <DetailRow label="Limits" value={`${ad.minAmount.toLocaleString()} - ${ad.maxAmount.toLocaleString()} ${ad.fiatCurrency}`} />
                          <DetailRow label="Payment Window" value={`${ad.paymentTimeLimit} minutes`} />
                          <DetailRow label="Payment Methods" value={<div className="flex flex-wrap gap-1 justify-end">{ad.paymentMethods.map(pm => <Badge key={pm} variant="outline">{pm}</Badge>)}</div>} />
                      </div>
                      <div className="space-y-2 text-sm p-3 border rounded-md bg-secondary/50 mt-2">
                          <p className="font-medium">Terms & Conditions</p>
                          <p className="text-muted-foreground whitespace-pre-wrap">{ad.terms}</p>
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

            <Button asChild className={cn(buttonColorClass, "gap-2")}>
              <Link href={`/ad/${ad.id}`}>
                {buttonLabel} <CryptoLogo crypto={ad.crypto as CryptoCurrency} className="h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </Card>
  );
}
