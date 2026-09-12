'use client';

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase/client';
import { useRouter, useParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent, CardDescription, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { ShieldCheck, ThumbsUp, ThumbsDown, Clock, AlertTriangle, ArrowRightLeft, ArrowLeft, Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import Link from 'next/link';
import { generateTradeId } from '@/lib/id-generator';

export default function AdDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { toast } = useToast();

  const rawAdId = (params?.adId || params?.id) as string;
  const adId = rawAdId ? rawAdId.replace(/^#/, '').trim() : '';

  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [ad, setAd] = useState<any>(null);
  const [trader, setTrader] = useState<any>(null);
  const [payAmount, setPayAmount] = useState<string>('');
  const [receiveAmount, setReceiveAmount] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    async function loadAdData() {
      setLoading(true);
      // 1. Get current logged in user
      const { data: { user } } = await supabase.auth.getUser();
      setCurrentUser(user);

      // 2. Fetch Ad details joining profiles
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(adId);
      
      let adResult: any = null;

      try {
        let query = supabase
          .from('p2p_ads')
          .select(`
            *,
            profiles:user_id (id, username, full_name, avatar_url, positive_feedback, negative_feedback, created_at)
          `);

        if (isUuid) {
          query = query.or(`id.eq.${adId},public_ad_id.eq.${adId},ad_id.eq.${adId},public_id.eq.${adId}`);
        } else {
          query = query.or(`public_ad_id.eq.${adId},public_id.eq.${adId},ad_id.eq.${adId}`);
        }

        const { data: adData } = await query.maybeSingle();
        if (adData) adResult = adData;
      } catch {}

      if (!adResult) {
        try {
          const { data: adsTableData } = await supabase
            .from('ads')
            .select(`
              *,
              profiles:user_id (id, username, full_name, avatar_url, positive_feedback, negative_feedback, created_at)
            `)
            .or(isUuid ? `id.eq.${adId},public_id.eq.${adId},public_ad_id.eq.${adId},ad_id.eq.${adId}` : `public_id.eq.${adId},public_ad_id.eq.${adId},ad_id.eq.${adId}`)
            .maybeSingle();
          if (adsTableData) adResult = adsTableData;
        } catch {}
      }

      // API route fallback
      if (!adResult) {
        try {
          const res = await fetch(`/api/ads/${encodeURIComponent(adId)}`);
          if (res.ok) {
            const json = await res.json();
            if (json && (json.id || json.ad)) {
              adResult = json.ad || json;
            }
          }
        } catch {}
      }

      if (!adResult) {
        setLoading(false);
        return;
      }

      setAd(adResult);
      setTrader(
        Array.isArray(adResult.profiles) ? adResult.profiles[0] : (adResult.profiles || adResult.user || { username: 'Verified Trader', positive_feedback: 100, negative_feedback: 0 })
      );
      const minLimit = adResult.min_limit || adResult.min_amount || 10;
      const unitP = adResult.fixed_rate || adResult.price || 1;
      setPayAmount(minLimit.toString());
      setReceiveAmount((minLimit / unitP).toFixed(8));
      setLoading(false);
    }

    if (adId) loadAdData();
  }, [adId, supabase, toast]);

  const handlePayChange = (val: string) => {
    setPayAmount(val);
    const num = parseFloat(val) || 0;
    const unitPrice = ad?.fixed_rate || ad?.price || 1;
    if (unitPrice > 0) {
      setReceiveAmount((num / unitPrice).toFixed(8));
    }
  };

  const handleInitiateTrade = async () => {
    if (!currentUser) {
      toast({ variant: 'destructive', title: 'Authentication Required', description: 'Please sign in to initiate a trade.' });
      router.push('/login');
      return;
    }

    const fiatVal = parseFloat(payAmount);
    const minLimit = ad.min_limit || ad.min_amount || 1;
    const maxLimit = ad.max_limit || ad.max_amount || 100000;
    const unitPrice = Number(ad.fixed_rate || ad.price || 1);

    if (isNaN(fiatVal) || fiatVal < minLimit || fiatVal > maxLimit) {
      toast({ variant: 'destructive', title: 'Invalid Amount', description: `Amount must be between $${minLimit} and $${maxLimit}.` });
      return;
    }

    setSubmitting(true);

    // Determine roles: If ad_type === 'SELL', ad creator sells, visitor buys.
    const isAdOwnerSeller = (ad.ad_type || ad.type || 'SELL').toUpperCase() === 'SELL';
    const sellerId = isAdOwnerSeller ? (ad.user_id || ad.seller_id) : currentUser.id;
    const buyerId = isAdOwnerSeller ? currentUser.id : (ad.user_id || ad.seller_id);

    // Balance check when visitor is selling crypto
    if (!isAdOwnerSeller) {
      const cryptoNeeded = fiatVal / unitPrice;
      const { data: wallet } = await supabase
        .from('wallets')
        .select('balance')
        .eq('user_id', currentUser.id)
        .maybeSingle();

      if (wallet && parseFloat(wallet.balance) < cryptoNeeded) {
        toast({
          variant: 'destructive',
          title: 'Insufficient Balance',
          description: `You need at least ${cryptoNeeded.toFixed(8)} ${ad.crypto_currency || ad.asset_symbol || 'BTC'} in your wallet.`
        });
        setSubmitting(false);
        return;
      }
    }

    const generatedTradeId = generateTradeId();
    const paymentMethods = Array.isArray(ad.payment_methods) 
      ? ad.payment_methods[0] 
      : (ad.payment_method || 'Bank Transfer');

    const tradePayload: Record<string, any> = {
      trade_id: generatedTradeId,
      seller_id: sellerId,
      buyer_id: buyerId,
      crypto_currency: ad.crypto_currency || ad.asset_symbol || 'BTC',
      asset_symbol: ad.crypto_currency || ad.asset_symbol || 'BTC',
      fiat_currency: ad.fiat_currency || ad.fiat_symbol || 'USD',
      crypto_amount: parseFloat(receiveAmount) || (fiatVal / unitPrice),
      amount: parseFloat(receiveAmount) || (fiatVal / unitPrice),
      fiat_amount: fiatVal,
      price: unitPrice,
      payment_method: paymentMethods,
      status: 'pending'
    };

    // If ad.id is a UUID, include ad_id
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ad.id)) {
      tradePayload.ad_id = ad.id;
    }

    const { data: trade, error } = await supabase
      .from('trades')
      .insert(tradePayload)
      .select()
      .single();

    if (error) {
      // Safe fallback insert without foreign key or non-base columns
      const { data: fallbackTrade, error: fbErr } = await supabase
        .from('trades')
        .insert({
          trade_id: generatedTradeId,
          seller_id: sellerId,
          buyer_id: buyerId,
          crypto_amount: parseFloat(receiveAmount) || (fiatVal / unitPrice),
          amount: parseFloat(receiveAmount) || (fiatVal / unitPrice),
          fiat_amount: fiatVal,
          price: unitPrice,
          status: 'pending',
        })
        .select()
        .single();

      if (fbErr) {
        toast({ variant: 'destructive', title: 'Trade Creation Failed', description: error.message || fbErr.message });
        setSubmitting(false);
        return;
      }

      toast({ title: 'Trade Initiated', description: 'Redirecting to secure trade room...' });
      router.push(`/trade/${fallbackTrade.trade_id || fallbackTrade.id}`);
      return;
    }

    toast({ title: 'Trade Initiated', description: 'Redirecting to secure trade room...' });
    router.push(`/trade/${trade.trade_id || trade.id}`);
  };

  if (loading) {
    return (
      <div className="min-h-[60vh] flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-500 mb-3" />
        <span>Loading offer details...</span>
      </div>
    );
  }

  if (!ad) {
    return (
      <div className="min-h-[50vh] flex flex-col items-center justify-center p-12 text-center space-y-4">
        <div className="text-destructive font-semibold">Offer unavailable or removed.</div>
        <Link href="/buy" className="text-sm text-primary hover:underline flex items-center gap-1.5">
          <ArrowLeft className="w-4 h-4" /> Return to Marketplace
        </Link>
      </div>
    );
  }

  const isOwner = currentUser?.id === ad.user_id;
  const isBuyAction = (ad.ad_type || ad.type || 'SELL').toUpperCase() === 'SELL';
  const cryptoSymbol = ad.crypto_currency || ad.asset_symbol || 'BTC';
  const fiatSymbol = ad.fiat_currency || ad.fiat_symbol || 'USD';
  const unitPrice = Number(ad.fixed_rate || ad.price || 1);
  const minLimit = ad.min_limit || ad.min_amount || 10;
  const maxLimit = ad.max_limit || ad.max_amount || 10000;
  const paymentMethodDisplay = Array.isArray(ad.payment_methods) 
    ? ad.payment_methods.join(', ') 
    : (ad.payment_method || 'Bank Transfer');

  return (
    <div className="container mx-auto px-4 py-8 max-w-7xl">
      <div className="mb-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            {isBuyAction ? `Buy ${cryptoSymbol} from ${trader?.username || 'Trader'}` : `Sell ${cryptoSymbol} to ${trader?.username || 'Trader'}`}
          </h1>
          <p className="text-sm text-muted-foreground">Ad ID: {ad.public_ad_id || ad.public_id || ad.id}</p>
        </div>
        <Link href="/buy" className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition">
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Offers
        </Link>
      </div>

      {/* 3-Column Desktop Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Column 1: Offer Summary (Stacked Top-to-Bottom) */}
        <div className="space-y-6">
          <Card className="border bg-card text-card-foreground shadow-sm">
            <CardHeader className="pb-3 border-b">
              <CardTitle className="text-lg flex items-center justify-between">
                <span>Offer Summary</span>
                <Badge variant={isBuyAction ? 'default' : 'secondary'}>
                  {isBuyAction ? `BUY ${cryptoSymbol}` : `SELL ${cryptoSymbol}`}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4 space-y-4 text-sm">
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-muted-foreground">Unit Price</span>
                <span className="font-bold text-base text-foreground">${unitPrice.toLocaleString()} {fiatSymbol}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-muted-foreground">Payment Limits</span>
                <span className="font-medium text-foreground">${minLimit} - ${maxLimit.toLocaleString()} {fiatSymbol}</span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-muted-foreground">Payment Method</span>
                <Badge variant="outline" className="font-semibold">{paymentMethodDisplay}</Badge>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-muted-foreground">Time Window</span>
                <span className="font-medium flex items-center gap-1 text-foreground"><Clock className="w-4 h-4" /> {ad.payment_window_minutes || 15} Minutes</span>
              </div>
            </CardContent>
          </Card>

          <Card className="border bg-card text-card-foreground shadow-sm">
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Seller Terms & Conditions</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                {ad.terms || 'No special terms specified. Please complete payment within the time limit.'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Column 2: Trade Action Form */}
        <div>
          <Card className="border bg-card text-card-foreground shadow-sm h-full flex flex-col justify-between">
            <div>
              <CardHeader className="border-b pb-3">
                <CardTitle className="text-lg">How much do you want to {isBuyAction ? 'buy' : 'sell'}?</CardTitle>
                <CardDescription>Enter the amount in fiat or crypto.</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-4">
                {isOwner && (
                  <Alert className="border-amber-500 bg-amber-500/10 text-amber-900 dark:text-amber-200">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Your Ad</AlertTitle>
                    <AlertDescription className="text-xs">
                      You created this offer. You cannot trade with yourself.
                    </AlertDescription>
                  </Alert>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground">You Pay ({fiatSymbol})</label>
                  <div className="relative">
                    <Input 
                      type="number" 
                      value={payAmount} 
                      onChange={(e) => handlePayChange(e.target.value)}
                      placeholder={`Min $${minLimit}`}
                      className="pr-16"
                    />
                    <span className="absolute right-3 top-2.5 text-xs font-bold text-muted-foreground">{fiatSymbol}</span>
                  </div>
                </div>

                <div className="flex justify-center my-1 text-muted-foreground">
                  <ArrowRightLeft className="w-5 h-5 rotate-90" />
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-muted-foreground">You Receive ({cryptoSymbol})</label>
                  <div className="relative">
                    <Input 
                      type="number" 
                      value={receiveAmount} 
                      readOnly
                      className="pr-16 bg-muted/50"
                    />
                    <span className="absolute right-3 top-2.5 text-xs font-bold text-muted-foreground">{cryptoSymbol}</span>
                  </div>
                </div>
              </CardContent>
            </div>

            <CardFooter className="pt-6 border-t">
              <Button 
                onClick={handleInitiateTrade}
                disabled={submitting || isOwner}
                className="w-full text-base font-bold h-12" 
                variant={isBuyAction ? 'default' : 'destructive'}
              >
                {submitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin" /> Initiating...
                  </span>
                ) : (
                  `${isBuyAction ? 'Buy' : 'Sell'} ${cryptoSymbol} Now`
                )}
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* Column 3: Trader Information Box */}
        <div>
          <Card className="border bg-card text-card-foreground shadow-sm">
            <CardHeader className="pb-3 border-b text-center">
              <div className="flex flex-col items-center gap-3">
                <Avatar className="h-20 w-20 border-2 border-primary">
                  <AvatarImage src={trader?.avatar_url} />
                  <AvatarFallback className="text-xl font-bold">{trader?.username?.substring(0, 2).toUpperCase() || 'TR'}</AvatarFallback>
                </Avatar>
                <div>
                  <CardTitle className="text-xl">{trader?.username || 'Verified Trader'}</CardTitle>
                  <p className="text-xs text-muted-foreground flex items-center justify-center gap-1 mt-1">
                    <ShieldCheck className="w-4 h-4 text-green-500" /> Verified Trader
                  </p>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-4 space-y-4 text-sm">
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-muted-foreground">Positive Feedback</span>
                <span className="font-semibold text-green-600 flex items-center gap-1">
                  <ThumbsUp className="w-4 h-4" /> {trader?.positive_feedback ?? 100}%
                </span>
              </div>
              <div className="flex justify-between items-center py-2 border-b">
                <span className="text-muted-foreground">Negative Feedback</span>
                <span className="font-semibold text-destructive flex items-center gap-1">
                  <ThumbsDown className="w-4 h-4" /> {trader?.negative_feedback ?? 0}
                </span>
              </div>
              <div className="flex justify-between items-center py-2">
                <span className="text-muted-foreground">Joined</span>
                <span className="font-medium text-foreground">
                  {trader?.created_at ? new Date(trader.created_at).toLocaleDateString() : '2026'}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
