'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { usePrices } from "@/context/price-context";
import { ALL_FIATS, SUPPORTED_CRYPTOS, CryptoLogo, FiatLogo } from "@/components/p2p/create-ad-utils";
import { Loader2, Lock, Percent, ArrowLeftRight, X } from "lucide-react";

const PAYMENT_CATEGORIES = {
  'Bank Transfers': ['Bank Transfer', 'Wire Transfer', 'SEPA', 'ACH', 'IMPS'],
  'Online Wallets': ['PayPal', 'Skrill', 'Neteller', 'Revolut', 'Wise'],
  'Mobile Money': ['UPI', 'M-Pesa', 'Venmo', 'Cash App', 'Paytm'],
  'Cash Payments': ['Cash in Person', 'Cash Deposit to Bank'],
  'Gift Cards': ['Amazon Gift Card', 'Apple Gift Card', 'Steam Gift Card'],
};

const AVAILABLE_TAGS = [
  'No third party',
  'No receipt required',
  'No verification',
  'Invoice accepted',
  'Fast release',
];

export default function CreateAdPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { prices, fiatRates } = usePrices();
  const supabase = createClient();

  // Auth User state
  const [currentUser, setCurrentUser] = useState<any>(null);

  // Core Ad Configuration
  const [adType, setAdType] = useState<'buy' | 'sell'>('sell');
  const [crypto, setCrypto] = useState('BTC');
  const [fiatCurrency, setFiatCurrency] = useState('USD');
  
  // Rate Configuration
  const [rateType, setRateType] = useState<'fixed' | 'float'>('float');
  const [ratePercent, setRatePercent] = useState('0');
  const [fixedRate, setFixedRate] = useState('');

  // Limits & Payment
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [paymentWindow, setPaymentWindow] = useState('30');
  const [selectedMethods, setSelectedMethods] = useState<string[]>(['Bank Transfer']);
  const [activeCategory, setActiveCategory] = useState<keyof typeof PAYMENT_CATEGORIES>('Bank Transfers');

  // Terms & Labels
  const [offerLabel, setOfferLabel] = useState('');
  const [terms, setTerms] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [minCompletedTrades, setMinCompletedTrades] = useState('0');

  // Targeting & Status
  const [targetedCountries, setTargetedCountries] = useState<string[]>([]);
  const [blockedCountries, setBlockedCountries] = useState<string[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    // 1. Fetch current session immediately
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setCurrentUser(session.user);
      }
    });

    // 2. Listen for auth state updates (token refresh, sign in, sign out)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user) {
          setCurrentUser(session.user);
        } else {
          setCurrentUser(null);
        }
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, [supabase]);

  const selectedFiat = ALL_FIATS.find((f) => f.code === fiatCurrency) || ALL_FIATS[0];

  const marketPriceUsd = prices[crypto as keyof typeof prices] || 0;
  const exchangeRate = fiatRates[fiatCurrency] || 1;
  const marketPriceInFiat = marketPriceUsd * exchangeRate;
  
  const estimatedAdPrice = rateType === 'fixed'
    ? parseFloat(fixedRate || '0')
    : marketPriceInFiat * (1 + parseFloat(ratePercent || '0') / 100);

  function togglePaymentMethod(method: string) {
    if (selectedMethods.includes(method)) {
      setSelectedMethods(selectedMethods.filter((m) => m !== method));
    } else {
      if (selectedMethods.length >= 5) {
        toast({ variant: "destructive", title: "Limit reached", description: "You can select up to 5 payment methods." });
        return;
      }
      setSelectedMethods([...selectedMethods, method]);
    }
  }

  function toggleTag(tag: string) {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  async function handleCreateAd(e: React.FormEvent) {
    e.preventDefault();

    if (!currentUser) {
      toast({ variant: "destructive", title: "Authentication required", description: "Please log in to create an ad." });
      router.push(`/login?redirect=/ads/create`);
      return;
    }

    if (!minAmount || !maxAmount || parseFloat(minAmount) >= parseFloat(maxAmount)) {
      toast({ variant: "destructive", title: "Invalid Limits", description: "Minimum trade amount must be less than maximum trade amount." });
      return;
    }

    if (selectedMethods.length === 0) {
      toast({ variant: "destructive", title: "Payment Method Required", description: "Please select at least one payment method." });
      return;
    }

    setIsSubmitting(true);

    try {
      // 1. Get current authenticated user
      const { data: { user }, error: userError } = await supabase.auth.getUser();

      if (userError || !user) {
        throw new Error("You must be logged in to create an ad.");
      }

      // 2. Insert ad into p2p_ads with user_id attached
      const { data, error } = await supabase
        .from('p2p_ads')
        .insert({
          user_id: user.id,
          user_display_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Trader',
          ad_type: adType,
          crypto,
          fiat_currency: fiatCurrency,
          rate_type: rateType,
          rate_percent: rateType === 'float' ? parseFloat(ratePercent) : null,
          fixed_rate: rateType === 'fixed' ? parseFloat(fixedRate) : null,
          min_amount: parseFloat(minAmount),
          max_amount: parseFloat(maxAmount),
          payment_window: parseInt(paymentWindow, 10),
          payment_methods: selectedMethods,
          offer_label: offerLabel || null,
          terms: terms || '',
          tags: selectedTags,
          min_completed_trades: parseInt(minCompletedTrades, 10),
          targeted_countries: targetedCountries,
          blocked_countries: blockedCountries,
          status: 'active',
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      toast({ title: "Ad Created!", description: "Your P2P advertisement is now live." });
      router.push(`/ad/${data.id}`);
    } catch (err: any) {
      toast({ 
        variant: "destructive", 
        title: "Failed to create ad", 
        description: err.message || "An error occurred while creating your advertisement." 
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-4 md:p-6">
      <Card className="border-border shadow-lg bg-card text-card-foreground rounded-2xl">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl font-bold flex items-center gap-2">
            <ArrowLeftRight className="h-6 w-6 text-primary" />
            Create a P2P Advertisement
          </CardTitle>
          <CardDescription>
            Set up your offer to buy or sell crypto with custom payment methods and rates.
          </CardDescription>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleCreateAd} className="space-y-6">
            {/* Buy / Sell Toggle */}
            <div className="grid grid-cols-2 gap-2 p-1.5 bg-muted rounded-xl">
              <Button
                type="button"
                variant={adType === 'buy' ? 'default' : 'ghost'}
                className={`h-11 font-semibold rounded-lg text-base ${
                  adType === 'buy' ? 'bg-emerald-600 hover:bg-emerald-500 text-white shadow' : 'text-muted-foreground'
                }`}
                onClick={() => setAdType('buy')}
              >
                I want to Buy
              </Button>
              <Button
                type="button"
                variant={adType === 'sell' ? 'default' : 'ghost'}
                className={`h-11 font-semibold rounded-lg text-base ${
                  adType === 'sell' ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow' : 'text-muted-foreground'
                }`}
                onClick={() => setAdType('sell')}
              >
                I want to Sell
              </Button>
            </div>

            {/* Asset & Fiat Pickers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">Coin</Label>
                <div className="grid grid-cols-4 gap-2">
                  {SUPPORTED_CRYPTOS.map((item) => (
                    <Button
                      key={item.symbol}
                      type="button"
                      variant={crypto === item.symbol ? "default" : "outline"}
                      className={`h-12 flex flex-col items-center justify-center p-1 rounded-xl transition-all ${
                        crypto === item.symbol ? 'border-2 border-primary bg-primary/10 text-primary font-bold' : ''
                      }`}
                      onClick={() => setCrypto(item.symbol)}
                    >
                      <CryptoLogo crypto={item.symbol} className="h-5 w-5 mb-0.5" />
                      <span className="text-xs">{item.symbol}</span>
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">With Fiat</Label>
                <Select value={fiatCurrency} onValueChange={setFiatCurrency}>
                  <SelectTrigger className="h-12 text-base rounded-xl">
                    <SelectValue>
                      <div className="flex items-center gap-2">
                        <FiatLogo countryCode={selectedFiat.country} />
                        <span className="font-semibold">{selectedFiat.code}</span>
                        <span className="text-xs text-muted-foreground">({selectedFiat.name})</span>
                      </div>
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {ALL_FIATS.map((fiat) => (
                      <SelectItem key={fiat.code} value={fiat.code}>
                        <div className="flex items-center gap-2">
                          <FiatLogo countryCode={fiat.country} />
                          <span className="font-medium">{fiat.code}</span>
                          <span className="text-xs text-muted-foreground">- {fiat.name}</span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Payment Method Selector */}
            <div className="space-y-3 p-4 bg-muted/40 rounded-xl border border-border">
              <div>
                <Label className="text-sm font-semibold">Payment Methods</Label>
                <p className="text-xs text-muted-foreground">Select up to 5 methods.</p>
              </div>

              <div className="flex flex-wrap gap-2 min-h-[32px]">
                {selectedMethods.map((method) => (
                  <Badge key={method} variant="secondary" className="px-3 py-1 text-xs gap-1 rounded-full">
                    {method}
                    <X className="h-3 w-3 cursor-pointer hover:text-destructive" onClick={() => togglePaymentMethod(method)} />
                  </Badge>
                ))}
              </div>

              <div className="flex gap-2 overflow-x-auto pb-1 border-b border-border text-xs">
                {Object.keys(PAYMENT_CATEGORIES).map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setActiveCategory(cat as any)}
                    className={`pb-1 font-medium whitespace-nowrap transition-colors ${
                      activeCategory === cat ? 'border-b-2 border-primary text-primary font-bold' : 'text-muted-foreground'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                {PAYMENT_CATEGORIES[activeCategory].map((method) => {
                  const isSelected = selectedMethods.includes(method);
                  return (
                    <Button
                      key={method}
                      type="button"
                      variant={isSelected ? "default" : "outline"}
                      size="sm"
                      className="h-8 text-xs rounded-lg"
                      onClick={() => togglePaymentMethod(method)}
                    >
                      {isSelected ? '✓ ' : '+ '} {method}
                    </Button>
                  );
                })}
              </div>
            </div>

            {/* Price Config */}
            <div className="p-4 bg-muted/40 rounded-xl border border-border space-y-4">
              <Label className="text-sm font-semibold">Pricing Strategy</Label>
              <div className="flex gap-6">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                  <input
                    type="radio"
                    name="rateType"
                    checked={rateType === 'float'}
                    onChange={() => setRateType('float')}
                    className="accent-primary"
                  />
                  Market Rate (Floating)
                </label>
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                  <input
                    type="radio"
                    name="rateType"
                    checked={rateType === 'fixed'}
                    onChange={() => setRateType('fixed')}
                    className="accent-primary"
                  />
                  Fixed Rate
                </label>
              </div>

              {rateType === 'float' ? (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Market Rate Adjustment (%)</Label>
                  <div className="relative">
                    <Input
                      type="number"
                      step="0.1"
                      value={ratePercent}
                      onChange={(e) => setRatePercent(e.target.value)}
                      className="h-10 pr-8 font-mono text-sm"
                    />
                    <Percent className="absolute right-3 top-3 h-4 w-4 text-muted-foreground" />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Current price: <span className="font-bold text-foreground">{estimatedAdPrice.toLocaleString(undefined, { style: 'currency', currency: fiatCurrency })}</span>
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label className="text-xs text-muted-foreground">Fixed Rate ({fiatCurrency})</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={fixedRate}
                    onChange={(e) => setFixedRate(e.target.value)}
                    placeholder="79000.00"
                    className="h-10 font-mono text-sm"
                  />
                </div>
              )}
            </div>

            {/* Trade Limits */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground uppercase">Min Trade Limit</Label>
                <Input
                  type="number"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                  placeholder="100"
                  className="h-11 font-mono"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground uppercase">Max Trade Limit</Label>
                <Input
                  type="number"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                  placeholder="5000"
                  className="h-11 font-mono"
                  required
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs font-semibold text-muted-foreground uppercase">Payment Window</Label>
                <Select value={paymentWindow} onValueChange={setPaymentWindow}>
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="15">15 minutes</SelectItem>
                    <SelectItem value="30">30 minutes</SelectItem>
                    <SelectItem value="60">60 minutes</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Terms */}
            <div className="space-y-4">
              <div className="space-y-1">
                <Label className="text-xs font-semibold uppercase text-muted-foreground">Terms & Conditions</Label>
                <Textarea
                  rows={3}
                  value={terms}
                  onChange={(e) => setTerms(e.target.value)}
                  placeholder="Write clear trading terms..."
                  className="resize-none"
                />
              </div>
            </div>

            <Button
              type="submit"
              size="lg"
              disabled={isSubmitting}
              className="w-full h-12 text-base font-bold shadow-lg"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  Publishing your advertisement...
                </>
              ) : (
                'Create Ad'
              )}
            </Button>
            
            <div className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
              <Lock className="h-3 w-3" />
              Protected by secure escrow & multi-layer account verification.
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
