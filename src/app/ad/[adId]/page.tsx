

'use client';

import { useParams, useRouter } from "next/navigation";
import { useFirebase, useDoc, useMemoFirebase } from "@/firebase";
import { doc } from "firebase/firestore";
import type { P2PAd, User, CryptoCurrency } from "@/lib/types";
import { useState } from "react";
import Link from "next/link";

import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { usePrices } from "@/context/price-context";
import { initiateTrade } from "@/lib/wallet";
import { cn, toDate } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Clock, ThumbsUp, X, Loader2, Lock, Award, ArrowLeftRight } from "lucide-react";
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from "@/components/icons";
import { FlagIcon } from "@/components/ui/flag-icon";
import { Tooltip, TooltipProvider, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from "@/components/ui/dialog";

const CryptoLogo = ({ crypto, className }: { crypto: string; className?: string }) => {
    switch (crypto) {
        case 'BTC': return <BtcLogo className={className} />;
        case 'ETH': return <EthLogo className={className} />;
        case 'LTC': return <LtcLogo className={className} />;
        case 'USDT': return <UsdtLogo className={className} />;
        default: return null;
    }
}

function StatItem({ icon, value, label }: { icon: React.ReactNode, value: string, label: string }) {
    return (
        <div className="flex items-center gap-1.5">
            {icon}
            <span className="font-medium">{value}</span>
            <span className="text-muted-foreground">{label}</span>
        </div>
    )
}

function TradeForm({ ad, adPrice, isForBuyingPage }: { ad: P2PAd, adPrice: number, isForBuyingPage: boolean }) {
    const { user: authUser, firestore } = useFirebase();
    const router = useRouter();
    const { toast } = useToast();
    const { fiatRates, isLoading: arePricesLoading } = usePrices();
    
    const [fiatAmount, setFiatAmount] = useState('');
    const [cryptoAmount, setCryptoAmount] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string>(ad.paymentMethods[0] || '');
    
    const onFiatChange = (value: string) => {
        setFiatAmount(value);
        if (value && adPrice > 0) {
            setCryptoAmount((parseFloat(value) / adPrice).toFixed(8));
        } else {
            setCryptoAmount('');
        }
    };

     const onCryptoChange = (value: string) => {
        setCryptoAmount(value);
        if (value && adPrice > 0) {
            setFiatAmount((parseFloat(value) * adPrice).toFixed(2));
        } else {
            setFiatAmount('');
        }
    };
    
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!authUser) {
             router.push(`/login?redirect=/ad/${ad.id}`);
             return;
        }
        if (!fiatAmount || !cryptoAmount || !ad || !firestore) return;
        
        setIsSubmitting(true);
        const fiatAmountNum = parseFloat(fiatAmount);
        const exchangeRate = fiatRates[ad.fiatCurrency] || 1;
        const fiatAmountInUSD = fiatAmountNum / exchangeRate;

        try {
            const tradeId = await initiateTrade(
                firestore, 
                authUser.uid, 
                ad, 
                parseFloat(cryptoAmount), 
                fiatAmountNum, 
                fiatAmountInUSD,
                selectedPaymentMethod
            );
            toast({ title: "Trade Initiated!", description: "You are being redirected to the trade room." });
            router.push(`/trade/${tradeId}`);
        } catch (error: any) {
            toast({ variant: 'destructive', title: "Trade Failed", description: error.message });
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="space-y-4">
                 <div className="space-y-4">
                    <div className="space-y-1">
                        <Label htmlFor="pay-amount" className="text-sm text-muted-foreground">{isForBuyingPage ? 'You pay' : 'You sell'}</Label>
                        <div className="relative">
                            <Input 
                                id="pay-amount"
                                value={isForBuyingPage ? fiatAmount : cryptoAmount} 
                                onChange={(e) => isForBuyingPage ? onFiatChange(e.target.value) : onCryptoChange(e.target.value)}
                                placeholder="0.00" 
                                className="h-12 pr-24 text-lg" 
                            />
                            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                                <Badge variant="secondary">{isForBuyingPage ? ad.fiatCurrency : ad.crypto}</Badge>
                            </div>
                        </div>
                    </div>
                    <div className="space-y-1">
                        <Label htmlFor="receive-amount" className="text-sm text-muted-foreground">{isForBuyingPage ? 'You receive' : 'You receive'}</Label>
                         <div className="relative">
                            <Input 
                                id="receive-amount"
                                value={isForBuyingPage ? cryptoAmount : fiatAmount} 
                                onChange={(e) => isForBuyingPage ? onCryptoChange(e.target.value) : onFiatChange(e.target.value)}
                                placeholder="0.00" 
                                className="h-12 pr-24 text-lg" 
                            />
                             <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                                <Button type="button" variant="ghost" size="sm" onClick={() => onFiatChange(ad.maxAmount.toString())}>MAX</Button>
                                <Badge variant="secondary">{isForBuyingPage ? ad.crypto : ad.fiatCurrency}</Badge>
                            </div>
                        </div>
                    </div>
                </div>
                <p className="text-xs text-muted-foreground">Range: {ad.minAmount.toLocaleString()} - {ad.maxAmount.toLocaleString()} {ad.fiatCurrency}</p>

                <div className="space-y-1">
                  <Label>Payment Method</Label>
                  {ad.paymentMethods.length > 1 ? (
                    <Select value={selectedPaymentMethod} onValueChange={setSelectedPaymentMethod}>
                      <SelectTrigger className="h-12 text-base">
                        <SelectValue placeholder="Select a payment method" />
                      </SelectTrigger>
                      <SelectContent>
                        {ad.paymentMethods.map(pm => (
                          <SelectItem key={pm} value={pm}>{pm}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="flex items-center p-3 text-sm font-medium bg-muted rounded-md h-12">
                      {ad.paymentMethods[0]}
                    </div>
                  )}
                </div>


                {ad.offerLabel && <div className="space-y-1 rounded-lg bg-muted/50 p-4">
                    <p className="text-sm text-muted-foreground">Offer label</p>
                    <p className="text-sm font-medium">{ad.offerLabel}</p>
                </div>}
                
                {ad.tags && ad.tags.length > 0 && (
                  <div className="space-y-1 rounded-lg bg-muted/50 p-4">
                    <p className="text-sm text-muted-foreground">Offer Tags</p>
                     <div className="flex flex-wrap gap-2">
                      {ad.tags.map(tag => (
                        <Badge key={tag} variant="secondary">{tag}</Badge>
                      ))}
                    </div>
                  </div>
                )}

                <div className="space-y-1 rounded-lg bg-muted/50 p-4">
                    <p className="text-sm text-muted-foreground">Offer terms</p>
                    <p className="text-sm font-medium whitespace-pre-wrap">{ad.terms}</p>
                </div>
            </div>

            <div className="mt-6 space-y-4">
                <Button type="submit" size="lg" className="w-full h-12 text-lg" disabled={isSubmitting || arePricesLoading || !fiatAmount || parseFloat(fiatAmount) < ad.minAmount || parseFloat(fiatAmount) > ad.maxAmount}>
                     {(isSubmitting || arePricesLoading) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                     {arePricesLoading ? 'Updating rates...' : authUser ? (isForBuyingPage ? 'Buy' : 'Sell') : 'Join & Trade'}
                </Button>
                <div className="text-xs text-muted-foreground flex items-center justify-center gap-2">
                    <Lock className="h-3 w-3" />
                    Your funds are protected by escrow for a secure trade.
                </div>
            </div>
        </form>
    );
}


export default function AdDetailPage() {
    const params = useParams();
    const router = useRouter();
    const { firestore } = useFirebase();
    const { prices, fiatRates, isLoading: arePricesLoading } = usePrices();
    const adId = Array.isArray(params.adId) ? params.adId[0] : params.adId;

    const adRef = useMemoFirebase(() => (adId ? doc(firestore, "p2p_ads", adId) : null), [firestore, adId]);
    const { data: ad, isLoading: isAdLoading } = useDoc<P2PAd>(adRef);

    const userRef = useMemoFirebase(() => (ad ? doc(firestore, 'users', ad.userId) : null), [ad]);
    const { data: user, isLoading: isUserLoading } = useDoc<User>(userRef);

    if (isAdLoading || isUserLoading || arePricesLoading) {
        return <div className="bg-card p-8 rounded-lg shadow-lg max-w-md w-full"><Skeleton className="h-[500px] w-full" /></div>
    }

    if (!ad || !user) {
        return (
            <div className="bg-card p-8 rounded-lg shadow-lg max-w-md w-full">
                <h1 className="text-xl font-bold">Ad Not Found</h1>
                <p className="text-muted-foreground mt-2">This ad may have been removed or is no longer available.</p>
                <Button onClick={() => router.back()} className="mt-4">Go Back</Button>
            </div>
        );
    }
    
    const marketPriceUsd = prices[ad.crypto] || 0;
    const exchangeRate = fiatRates[ad.fiatCurrency] || 1;
    const marketPriceInFiat = marketPriceUsd * exchangeRate;
    
    const adPrice = ad.rateType === 'fixed' 
        ? ad.fixedRate! 
        : marketPriceInFiat * (1 + (ad.ratePercent || 0) / 100);

    const pricePremium = marketPriceInFiat > 0 ? (adPrice - marketPriceInFiat) / marketPriceInFiat : 0;
    const isForBuyingPage = ad.adType === 'sell';

    const priceBadgeClass = isForBuyingPage 
    ? (pricePremium >= 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700') 
    : (pricePremium >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700');

    const lastActiveDate = toDate(user.lastActive);

    const userBadges = (user.badges || []);
    const displayedBadges = userBadges.slice(0, 4);
    const hiddenBadgesCount = userBadges.length - displayedBadges.length;
    
    return (
        <div className="bg-card text-card-foreground p-6 rounded-2xl shadow-lg max-w-md w-full relative">
            <Button variant="ghost" size="icon" className="absolute top-4 right-4 rounded-full h-8 w-8" onClick={() => router.back()}>
                <X className="h-5 w-5" />
            </Button>
            <div className="space-y-4">
                <div className="flex items-center gap-2">
                    {user.country && <FlagIcon countryCode={user.country} className="w-6 h-auto" />}
                    <h1 className="text-xl font-bold">{user.userId}</h1>
                    <div className="flex items-center gap-1">
                        {displayedBadges.map((badge, i) => (
                           <TooltipProvider key={i}><Tooltip><TooltipTrigger>
                           <Badge variant="outline" className="p-1">
                               <Award className="h-3 w-3 text-amber-500" />
                           </Badge>
                           </TooltipTrigger><TooltipContent>{badge}</TooltipContent></Tooltip></TooltipProvider>
                        ))}
                        {hiddenBadgesCount > 0 && <Badge variant="secondary">+{hiddenBadgesCount} more</Badge>}
                    </div>
                </div>
                <div className="flex items-center gap-4 text-xs flex-wrap">
                    <StatItem icon={<ThumbsUp className="h-4 w-4 text-green-500"/>} value={`${user.feedbackScore || 100}%`} label="" />
                    <StatItem icon={<Clock />} value={`${user.avgReleaseTime.toFixed(1)}m`} label="" />
                    <StatItem icon={<ArrowLeftRight />} value={user.completedTrades.toLocaleString()} label="Trades" />
                    {lastActiveDate && <StatItem icon={<div className="h-2 w-2 rounded-full bg-green-500" />} value={`Seen ${formatDistanceToNow(lastActiveDate)} ago`} label="" />}
                </div>

                <div className="text-right">
                    <span className="text-sm text-muted-foreground">Rate: </span>
                    <CryptoLogo crypto={ad.crypto} className="h-4 w-4 inline-block mx-1" />
                    <span className="font-bold">{adPrice.toLocaleString(undefined, {style: 'currency', currency: ad.fiatCurrency, minimumFractionDigits: 2})}</span>
                    {marketPriceInFiat > 0 && (
                        <Badge className={cn('ml-2 font-semibold', priceBadgeClass)}>
                            {pricePremium >= 0 ? '+' : ''}{(pricePremium * 100).toFixed(2)}%
                        </Badge>
                    )}
                </div>
                
                <TradeForm ad={ad} adPrice={adPrice} isForBuyingPage={isForBuyingPage} />
            </div>
        </div>
    );
}
