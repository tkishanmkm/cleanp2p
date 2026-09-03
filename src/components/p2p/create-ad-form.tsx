

'use client';

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { SUPPORTED_CRYPTOS, AD_TAGS } from "@/lib/constants";
import { currencies } from "@/lib/currencies";
import { countries } from "@/lib/countries";
import {
  bankTransfers,
  onlineWallets,
  mobileMoney,
  cashPayments,
  giftCardPaymentMethods,
} from "@/lib/payment-methods";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/providers/auth-provider";
import { getUserWalletBalances } from "@/lib/wallet";
import type { User, P2PAd, CryptoCurrency } from "@/lib/types";
import { createP2PAd, updateAd } from "@/lib/ads";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Badge } from "../ui/badge";
import { Checkbox } from "../ui/checkbox";
import { usePrices } from "@/context/price-context";
import { useEffect, useState, useMemo } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Loader2, Wallet, Edit, Search, Globe, Landmark, CreditCard, Smartphone, Car } from "lucide-react";
import { calculateMinimumFiatAmount, BASE_PLATFORM_USD_MINIMUM } from "@/lib/currency";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { FlagIcon } from "../ui/flag-icon";
import { Label } from "../ui/label";

const adTags = AD_TAGS.map((label) => ({
  id: label.toLowerCase().replace(/ /g, '-'),
  label,
}));

const adFormSchema = z.object({
  adType: z.enum(["buy", "sell"]),
  crypto: z.string().min(1, "Please select a coin."),
  fiatCurrency: z.string().min(1, "Please select a fiat currency."),

  targetedCountries: z.array(z.string()).optional(),
  blockedCountries: z.array(z.string()).optional(),

  paymentMethods: z.array(z.string()).min(1, "Select at least one payment method.").max(5, "You can select up to 5 payment methods."),
  rateType: z.enum(["market", "fixed"]),
  ratePercent: z.coerce.number({
    invalid_type_error: "A valid percentage is required.",
  })
    .min(-50, { message: "Please enter a value from -50 to 50." })
    .max(50, { message: "Please enter a value from -50 to 50." })
    .optional(),
  fixedRate: z.coerce.number({ invalid_type_error: "A valid number is required." }).positive({ message: "Fixed rate must be a positive number." }).optional(),
  minAmount: z.coerce.number().min(1, "Minimum amount is required."),
  maxAmount: z.coerce.number().min(1, "Maximum amount is required."),
  paymentTimeLimit: z.coerce.number().min(30).default(30),
  minCompletedTrades: z.coerce.number().min(0).max(5).default(0),
  terms: z.string().min(10, "Terms must be at least 10 characters.").max(500, "Terms cannot exceed 500 characters."),
  tags: z.array(z.string()).optional(),
  offerLabel: z.string().max(30, "Offer label cannot exceed 30 characters.").optional(),
}).superRefine((data, ctx) => {
  if (data.rateType === 'market') {
    if (data.ratePercent === undefined || data.ratePercent === null || isNaN(data.ratePercent)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Market rate adjustment is required.",
        path: ["ratePercent"],
      });
    }
  }
  if (data.rateType === 'fixed') {
    if (data.fixedRate === undefined || data.fixedRate === null || isNaN(data.fixedRate) || data.fixedRate <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A positive fixed rate is required.",
        path: ["fixedRate"],
      });
    }
  }
  if (data.maxAmount < data.minAmount) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Max amount must be greater than or equal to min amount.",
      path: ["maxAmount"],
    });
  }
});

type AdFormValues = z.infer<typeof adFormSchema>;

interface CreateAdFormProps {
  ad?: P2PAd;
}

const PaymentMethodSheet = ({ open, onOpenChange, title, description, methods, field, addCustom, customValue, onCustomValueChange }: any) => {
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const filteredMethods = methods.filter((pm: string) => pm.toLowerCase().includes(searchTerm.toLowerCase()));

  const addPaymentMethod = (method: string) => {
    if (!method) return;
    const currentMethods = field.value || [];
    if (currentMethods.length >= 5) {
      toast({ variant: 'destructive', title: 'Limit Reached', description: 'You can only add up to 5 payment methods.' });
      return;
    }
    if (currentMethods.map((c: string) => c.toLowerCase()).includes(method.toLowerCase())) {
      toast({ variant: 'destructive', title: 'Duplicate', description: 'This payment method has already been added.' });
      return;
    }
    field.onChange([...currentMethods, method]);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="flex flex-col">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>{description}</SheetDescription>
        </SheetHeader>
        <div className="py-2 space-y-2">
          {addCustom && (
            <div className="flex items-center gap-2">
              <Input
                placeholder="Type a custom method"
                value={customValue}
                onChange={(e) => onCustomValueChange(e.target.value)}
              />
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  addPaymentMethod(customValue.trim());
                  onCustomValueChange('');
                }}
              >
                Add
              </Button>
            </div>
          )}
          <Input
            placeholder="Search methods..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <ScrollArea className="flex-grow rounded-md border">
          <div className="p-4 space-y-4">
            {filteredMethods.map((pm: string) => (
              <div key={pm} className="flex flex-row items-center space-x-3 space-y-0 py-2">
                <Checkbox
                  id={`pm-sheet-${pm}`}
                  checked={field.value?.includes(pm)}
                  onCheckedChange={(checked) => {
                    if (field.value?.length >= 5 && checked) {
                      toast({ variant: 'destructive', title: 'Limit Reached', description: 'You can only add up to 5 payment methods.' });
                      return;
                    }
                    return checked
                      ? field.onChange([...(field.value || []), pm])
                      : field.onChange(field.value?.filter((v: string) => v !== pm));
                  }}
                />
                <Label htmlFor={`pm-sheet-${pm}`} className="font-normal w-full cursor-pointer">{pm}</Label>
              </div>
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
};

export function CreateAdForm({ ad }: CreateAdFormProps) {
  const { toast } = useToast();
  const router = useRouter();
  const { user, profile } = useAuth();
  const { prices, fiatRates, isLoading: arePricesLoading } = usePrices();
  const [balanceError, setBalanceError] = useState<string | null>(null);
  const [customPaymentMethod, setCustomPaymentMethod] = useState('');
  const [currencySearchTerm, setCurrencySearchTerm] = useState("");
  const [countrySearchTerm, setCountrySearchTerm] = useState("");
  const [isCurrencySheetOpen, setIsCurrencySheetOpen] = useState(false);
  const [isTargetCountrySheetOpen, setIsTargetCountrySheetOpen] = useState(false);
  const [isBlockedCountrySheetOpen, setIsBlockedCountrySheetOpen] = useState(false);
  const [userBalances, setUserBalances] = useState<{ [key in CryptoCurrency]?: { balance: number; lockedBalance: number } }>({});

  const [paymentSheetState, setPaymentSheetState] = useState({
    bank: false,
    wallet: false,
    mobile: false,
    cash: false,
    giftCard: false,
  });

  const adCreatorId = ad?.userId || user?.uid;

  useEffect(() => {
    if (!adCreatorId) return;
    let isMounted = true;
    async function loadBalances() {
      try {
        const balances = await getUserWalletBalances(adCreatorId);
        if (isMounted && balances) {
          setUserBalances(balances);
        }
      } catch (err) {
        console.error("Failed to load balances:", err);
      }
    }
    loadBalances();
    return () => { isMounted = false; };
  }, [adCreatorId]);

  const form = useForm<AdFormValues>({
    resolver: zodResolver(adFormSchema),
    shouldUnregister: false,
    defaultValues: ad
      ? {
        ...ad,
        ratePercent: ad.ratePercent ?? 5,
        paymentTimeLimit: ad.paymentTimeLimit || 30,
        minCompletedTrades: ad.minCompletedTrades || 0,
        paymentMethods: ad.paymentMethods || [],
        tags: ad.tags || [],
        targetedCountries: ad.targetedCountries || [],
        blockedCountries: ad.blockedCountries || [],
      }
      : {
        adType: 'buy',
        crypto: "BTC",
        fiatCurrency: "USD",
        paymentMethods: [],
        rateType: "market",
        ratePercent: 5,
        paymentTimeLimit: 30,
        minCompletedTrades: 0,
        tags: [],
        targetedCountries: [],
        blockedCountries: [],
      },
  });

  const watchedAdType = form.watch('adType');
  const watchedCrypto = form.watch('crypto');
  const watchedFiat = form.watch('fiatCurrency');
  const watchedMaxAmount = form.watch('maxAmount');
  const watchedRateType = form.watch('rateType');
  const watchedFixedRate = form.watch('fixedRate');
  const watchedRatePercent = form.watch('ratePercent');

  const currentMarketPriceInFiat = useMemo(() => {
    if (!watchedCrypto || !watchedFiat) return 0;
    const marketPriceUsd = prices[watchedCrypto as CryptoCurrency] || 0;
    const exchangeRate = fiatRates[watchedFiat] || 1;
    return marketPriceUsd * exchangeRate;
  }, [watchedCrypto, watchedFiat, prices, fiatRates]);

  const dynamicPlatformMin = useMemo(() => {
    return calculateMinimumFiatAmount(BASE_PLATFORM_USD_MINIMUM, watchedFiat || 'USD', fiatRates as any);
  }, [watchedFiat, fiatRates]);

  const hasPositiveMarketPrice = currentMarketPriceInFiat > 0;

  // Pre-fill defaults only when rateType actively switches or initially empty
  useEffect(() => {
    if (!hasPositiveMarketPrice || arePricesLoading) return;

    if (watchedRateType === "market") {
      const currentVal = form.getValues("ratePercent");
      if (currentVal === undefined || currentVal === null || isNaN(currentVal)) {
        form.setValue("ratePercent", 5);
      }
      form.setValue("fixedRate", undefined, { shouldValidate: false });
    }

    if (watchedRateType === "fixed") {
      const currentFixed = form.getValues("fixedRate");
      if (!currentFixed || isNaN(currentFixed)) {
        form.setValue("fixedRate", Number(currentMarketPriceInFiat.toFixed(2)));
      }
      form.setValue("ratePercent", undefined, { shouldValidate: false });
    }
  }, [watchedRateType, hasPositiveMarketPrice, arePricesLoading, currentMarketPriceInFiat, form]);


  useEffect(() => {
    setBalanceError(null);
    if (watchedAdType !== 'sell' || !watchedMaxAmount || !watchedCrypto || arePricesLoading) {
      return;
    }

    const userBalance = userBalances[watchedCrypto as CryptoCurrency]?.balance ?? 0;

    const price = watchedRateType === 'fixed'
      ? watchedFixedRate ?? 0
      : currentMarketPriceInFiat > 0 ? currentMarketPriceInFiat * (1 + (watchedRatePercent ?? 0) / 100) : 0;

    if (price <= 0) return;

    const requiredCryptoForMaxAmount = watchedMaxAmount / price;

    if (userBalance < requiredCryptoForMaxAmount) {
      setBalanceError(`Insufficient ${watchedCrypto} balance. You need at least ${requiredCryptoForMaxAmount.toFixed(6)} ${watchedCrypto} to cover the maximum amount, but you only have ${userBalance.toFixed(6)} available.`);
    }

  }, [watchedAdType, watchedMaxAmount, watchedCrypto, watchedRateType, watchedFixedRate, watchedRatePercent, userBalances, arePricesLoading, currentMarketPriceInFiat]);


  const cryptoOptions = SUPPORTED_CRYPTOS.map((c) => ({ value: c.name, label: c.name }));

  const filteredCurrencies = currencies.filter(c =>
    c.name.toLowerCase().includes(currencySearchTerm.toLowerCase()) ||
    c.code.toLowerCase().includes(currencySearchTerm.toLowerCase())
  );

  const filteredCountries = [{ name: 'All Countries', code: 'all' }, ...countries].filter(c =>
    c.name.toLowerCase().includes(countrySearchTerm.toLowerCase())
  );

  async function onSubmit(data: AdFormValues) {
    if (!user || !profile) {
      toast({ variant: "destructive", title: "Error", description: "You must be logged in." });
      return;
    }
    if (balanceError) {
      toast({ variant: "destructive", title: "Cannot Create Ad", description: "Please resolve the balance issue first." });
      return;
    }
    if (data.minAmount < dynamicPlatformMin) {
      form.setError('minAmount', {
        type: 'manual',
        message: `Minimum amount must be at least ${dynamicPlatformMin} ${data.fiatCurrency} (converted from $${BASE_PLATFORM_USD_MINIMUM} USD).`,
      });
      toast({
        variant: "destructive",
        title: "Minimum Amount Not Met",
        description: `The minimum trade amount is ${dynamicPlatformMin} ${data.fiatCurrency} ($${BASE_PLATFORM_USD_MINIMUM} USD equivalent).`,
      });
      return;
    }

    const adPayload: any = {
      adType: data.adType,
      crypto: data.crypto as CryptoCurrency,
      fiatCurrency: data.fiatCurrency,
      paymentMethods: data.paymentMethods,
      rateType: data.rateType,
      ratePercent: data.rateType === 'market' ? data.ratePercent : undefined,
      fixedRate: data.rateType === 'fixed' ? data.fixedRate : undefined,
      minAmount: data.minAmount,
      maxAmount: data.maxAmount,
      paymentTimeLimit: data.paymentTimeLimit,
      terms: data.terms,
      tags: data.tags,
      offerLabel: data.offerLabel,
      active: ad?.active ?? true,
      targetedCountries: data.targetedCountries,
      blockedCountries: data.blockedCountries,
      minCompletedTrades: data.minCompletedTrades,
    };
    
    // Remove undefined keys
    Object.keys(adPayload).forEach(key => {
      if (adPayload[key] === undefined) {
        delete adPayload[key];
      }
    });

    const adData = adPayload as Omit<P2PAd, 'id' | 'createdAt' | 'user' | 'userId' | 'publicAdId'>;

    try {
      if (ad) { // Editing existing ad
        await updateAd(null, ad.id, adData);
        toast({ title: "Ad Updated", description: "Your ad has been successfully updated." });
        router.push('/my-ads');
      } else { // Creating new ad
        await createP2PAd(null, adData, {
          id: user.uid,
          username: profile.username || 'User',
          country: profile.country,
          feedbackScore: profile.feedbackScore ?? 100,
          positiveFeedback: profile.positiveFeedback ?? 0,
          negativeFeedback: profile.negativeFeedback ?? 0,
          completedTrades: profile.completedTrades ?? 0,
          photoURL: profile.photoURL,
          badges: profile.badges,
          lastActive: profile.lastActive,
        });
        toast({ title: "Ad Created", description: "Your ad has been successfully posted." });
        router.push(data.adType === 'sell' ? '/buy' : '/sell');
      }
    } catch (error: any) {
      console.error(error);
      toast({ variant: "destructive", title: "Operation Failed", description: error.message || "An unexpected error occurred. Please check the console." });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{ad ? 'Edit P2P Advertisement' : 'Create a P2P Advertisement'}</CardTitle>
        <CardDescription>
          {ad ? `Editing ad ${ad.publicAdId}.` : `Set up your ad to buy or sell coins. It will be visible to other users.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
            <FormField
              control={form.control}
              name="adType"
              render={({ field }) => (
                <FormItem>
                  <FormControl>
                    <Tabs
                      value={field.value}
                      onValueChange={(value) => field.onChange(value as 'buy' | 'sell')}
                      className="w-full"
                    >
                      <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="buy" className="data-[state=active]:bg-green-600 data-[state=active]:text-primary-foreground">I want to Buy</TabsTrigger>
                        <TabsTrigger value="sell" className="data-[state=active]:bg-red-600 data-[state=active]:text-primary-foreground">I want to Sell</TabsTrigger>
                      </TabsList>
                    </Tabs>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-8">
              <FormField
                control={form.control}
                name="crypto"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Coin</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl>
                        <SelectTrigger><SelectValue placeholder="Select a coin" /></SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {cryptoOptions.map(opt => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="fiatCurrency"
                render={({ field }) => {
                  const selectedCurrency = currencies.find(c => c.code === field.value);
                  return (
                    <FormItem>
                      <FormLabel>With Fiat</FormLabel>
                      <div className="flex items-center justify-between p-4 border rounded-lg bg-secondary/50">
                        <div>
                          <p className="font-semibold text-lg">{selectedCurrency?.name || 'Select a currency'}</p>
                          <p className="text-muted-foreground">{selectedCurrency?.code || ''}</p>
                        </div>
                        <div>
                          <Sheet open={isCurrencySheetOpen} onOpenChange={setIsCurrencySheetOpen}>
                            <SheetTrigger asChild>
                              <Button type="button" variant="outline">
                                <Edit className="mr-2 h-4 w-4" /> Change
                              </Button>
                            </SheetTrigger>
                            <SheetContent className="flex flex-col">
                              <SheetHeader>
                                <SheetTitle>Change Fiat Currency</SheetTitle>
                                <SheetDescription>
                                  Select the currency for your ad.
                                </SheetDescription>
                              </SheetHeader>
                              <div className="space-y-4 flex-grow">
                                <Input
                                  placeholder="Search currency..."
                                  value={currencySearchTerm}
                                  onChange={(e) => setCurrencySearchTerm(e.target.value)}
                                />
                                <RadioGroup
                                  onValueChange={(value) => {
                                    field.onChange(value);
                                    setIsCurrencySheetOpen(false); // Close sheet on selection
                                  }}
                                  value={field.value}
                                  className="space-y-1"
                                >
                                  <ScrollArea className="h-[calc(100vh-12rem)] w-full rounded-md border">
                                    <div className="p-4">
                                      {filteredCurrencies.map((currency) => (
                                        <FormItem key={currency.code} className="flex items-center space-x-3 space-y-0 p-2 rounded-md hover:bg-muted/50">
                                          <FormControl>
                                            <RadioGroupItem value={currency.code} id={`sheet-fiat-${currency.code}`} />
                                          </FormControl>
                                          <FormLabel htmlFor={`sheet-fiat-${currency.code}`} className="font-normal w-full cursor-pointer">
                                            {currency.name} ({currency.code})
                                          </FormLabel>
                                        </FormItem>
                                      ))}
                                    </div>
                                  </ScrollArea>
                                </RadioGroup>
                              </div>
                            </SheetContent>
                          </Sheet>
                        </div>
                      </div>
                      <FormMessage />
                    </FormItem>
                  )
                }}
              />
            </div>

            <FormField
              control={form.control}
              name="paymentMethods"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Payment Methods</FormLabel>
                  <FormDescription>Select up to 5 methods. Add a custom method if yours isn't listed under a category.</FormDescription>
                  <div className="flex flex-wrap gap-2 pt-2 min-h-[2.5rem]">
                    {field.value?.map((pm, index) => (
                      <Badge key={index} variant="secondary">
                        {pm}
                        <button type="button" onClick={() => {
                          const updatedPms = field.value?.filter((_, i) => i !== index) || [];
                          field.onChange(updatedPms);
                        }} className="ml-2 rounded-full hover:bg-destructive/50 p-0.5">&times;</button>
                      </Badge>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-2">
                    <Button type="button" variant="outline" onClick={() => setPaymentSheetState(s => ({ ...s, bank: true }))}><Landmark className="mr-2 h-4 w-4" /> Bank Transfers</Button>
                    <Button type="button" variant="outline" onClick={() => setPaymentSheetState(s => ({ ...s, wallet: true }))}><Wallet className="mr-2 h-4 w-4" /> Online Wallets</Button>
                    <Button type="button" variant="outline" onClick={() => setPaymentSheetState(s => ({ ...s, mobile: true }))}><Smartphone className="mr-2 h-4 w-4" /> Mobile Money</Button>
                    <Button type="button" variant="outline" onClick={() => setPaymentSheetState(s => ({ ...s, cash: true }))}><Car className="mr-2 h-4 w-4" /> Cash Payments</Button>
                    <Button type="button" variant="outline" onClick={() => setPaymentSheetState(s => ({ ...s, giftCard: true }))}><CreditCard className="mr-2 h-4 w-4" /> Gift Cards</Button>
                  </div>

                  <PaymentMethodSheet
                    open={paymentSheetState.bank}
                    onOpenChange={(v: boolean) => setPaymentSheetState(s => ({ ...s, bank: v }))}
                    title="Bank Transfers"
                    description="Select bank transfer methods."
                    methods={bankTransfers}
                    field={field}
                    addCustom={true}
                    customValue={customPaymentMethod}
                    onCustomValueChange={setCustomPaymentMethod}
                  />
                  <PaymentMethodSheet
                    open={paymentSheetState.wallet}
                    onOpenChange={(v: boolean) => setPaymentSheetState(s => ({ ...s, wallet: v }))}
                    title="Online Wallets"
                    description="Select online wallet methods."
                    methods={onlineWallets}
                    field={field}
                  />
                  <PaymentMethodSheet
                    open={paymentSheetState.mobile}
                    onOpenChange={(v: boolean) => setPaymentSheetState(s => ({ ...s, mobile: v }))}
                    title="Mobile Money"
                    description="Select mobile money methods."
                    methods={mobileMoney}
                    field={field}
                  />
                  <PaymentMethodSheet
                    open={paymentSheetState.cash}
                    onOpenChange={(v: boolean) => setPaymentSheetState(s => ({ ...s, cash: v }))}
                    title="Cash Payments"
                    description="Select in-person or cash-based methods."
                    methods={cashPayments}
                    field={field}
                  />
                  <PaymentMethodSheet
                    open={paymentSheetState.giftCard}
                    onOpenChange={(v: boolean) => setPaymentSheetState(s => ({ ...s, giftCard: v }))}
                    title="Gift Cards"
                    description="Select gift card methods."
                    methods={giftCardPaymentMethods}
                    field={field}
                  />

                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="rateType"
              render={({ field }) => (
                <FormItem className="space-y-3">
                  <FormLabel>Pricing</FormLabel>
                  <FormControl>
                    <RadioGroup
                      onValueChange={field.onChange}
                      value={field.value}
                      className="flex flex-col md:flex-row gap-4"
                    >
                      <FormItem className="flex-1 flex items-center space-x-3 space-y-0 border p-4 rounded-md has-[:checked]:border-primary">
                        <FormControl><RadioGroupItem value="market" /></FormControl>
                        <FormLabel className="font-normal w-full">Market Rate</FormLabel>
                      </FormItem>
                      <FormItem className="flex-1 flex items-center space-x-3 space-y-0 border p-4 rounded-md has-[:checked]:border-primary">
                        <FormControl><RadioGroupItem value="fixed" /></FormControl>
                        <FormLabel className="font-normal w-full">Fixed Rate</FormLabel>
                      </FormItem>
                    </RadioGroup>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            {watchedRateType === "market" ? (
              <FormField
                control={form.control}
                name="ratePercent"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Market Rate Adjustment</FormLabel>
                    <div className="relative">
                      <Input type="number" step="0.01" placeholder="e.g. 5" {...field} onChange={(e) => field.onChange(parseFloat(e.target.value))} value={field.value ?? ''} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                    </div>
                    <FormDescription>
                      Your price will float with the market. {arePricesLoading ? 'Loading market price...' : `Current price is approx. ${currentMarketPriceInFiat.toLocaleString(undefined, { style: 'currency', currency: form.getValues('fiatCurrency'), minimumFractionDigits: 2 })}.`} <br />
                      Set your adjustment percentage (from -50% to 50%). E.g., '1.5' for 1.5% above market.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            ) : (
              <FormField
                control={form.control}
                name="fixedRate"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Fixed Price per Coin</FormLabel>
                    <Input
                      type="number"
                      step="any"
                      placeholder={arePricesLoading ? "Loading..." : `${currentMarketPriceInFiat.toLocaleString()}`}
                      {...field}
                      onChange={(e) => field.onChange(parseFloat(e.target.value))}
                      value={field.value ?? ''}
                    />
                    <FormDescription>The fixed price in {form.getValues('fiatCurrency')}. Current market price is approx. {currentMarketPriceInFiat.toLocaleString(undefined, { style: 'currency', currency: form.getValues('fiatCurrency'), minimumFractionDigits: 2 })}.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            )}

            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <FormField
                control={form.control}
                name="minAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Minimum Trade Amount</FormLabel>
                    <Input type="number" placeholder={String(dynamicPlatformMin)} {...field} />
                    <FormDescription>
                      Minimum allowed: {dynamicPlatformMin} {watchedFiat || 'USD'} ($${BASE_PLATFORM_USD_MINIMUM} USD equivalent).
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="maxAmount"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Maximum Trade Amount</FormLabel>
                    <Input type="number" placeholder="5000" {...field} />
                    <FormDescription>In your selected fiat currency.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="paymentTimeLimit"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Payment Window</FormLabel>
                    <Select onValueChange={(val) => field.onChange(parseInt(val))} defaultValue={String(field.value)}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select a time limit" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {[30, 60, 90, 120].map(time => (
                          <SelectItem key={time} value={String(time)}>
                            {time} minutes
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>Time buyer has to pay.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <FormField
                control={form.control}
                name="targetedCountries"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Targeted Countries (Optional)</FormLabel>
                    <FormDescription>Only show this ad to users from these countries.</FormDescription>
                    <div className="flex flex-wrap gap-2 pt-2 min-h-[2.5rem]">
                      {field.value?.map((code, index) => {
                        const country = countries.find(c => c.code === code) || { name: code };
                        return (
                          <Badge key={index} variant="secondary">
                            {country.name}
                            <button type="button" onClick={() => field.onChange(field.value?.filter(c => c !== code))} className="ml-2 rounded-full hover:bg-destructive/50 p-0.5">&times;</button>
                          </Badge>
                        )
                      })}
                    </div>
                    <Sheet open={isTargetCountrySheetOpen} onOpenChange={setIsTargetCountrySheetOpen}>
                      <SheetTrigger asChild>
                        <Button type="button" variant="outline" className="w-full">
                          <Edit className="mr-2 h-4 w-4" /> Select Targeted Countries
                        </Button>
                      </SheetTrigger>
                      <SheetContent className="flex flex-col">
                        <SheetHeader><SheetTitle>Select Countries</SheetTitle></SheetHeader>
                        <Input placeholder="Search countries..." value={countrySearchTerm} onChange={(e) => setCountrySearchTerm(e.target.value)} />
                        <ScrollArea className="flex-grow rounded-md border">
                          <div className="p-4 space-y-1">
                            {filteredCountries.map(country => (
                              <FormItem key={`target-${country.code}`} className="flex flex-row items-center space-x-3 space-y-0 p-2 rounded-md hover:bg-muted/50">
                                <FormControl>
                                  <Checkbox
                                    checked={field.value?.includes(country.code)}
                                    onCheckedChange={(checked) => {
                                      const currentSelection = field.value || [];
                                      if (country.code === 'all') {
                                        field.onChange(checked ? ['all'] : []);
                                      } else {
                                        const withoutAll = currentSelection.filter(c => c !== 'all');
                                        return checked
                                          ? field.onChange([...withoutAll, country.code])
                                          : field.onChange(withoutAll.filter(c => c !== country.code));
                                      }
                                    }}
                                  />
                                </FormControl>
                                <FormLabel className="font-normal w-full cursor-pointer flex items-center gap-2">
                                  {country.code === 'all' ? <Globe className="h-4 w-4" /> : <FlagIcon countryCode={country.code} />} {country.name}
                                </FormLabel>
                              </FormItem>
                            ))}
                          </div>
                        </ScrollArea>
                      </SheetContent>
                    </Sheet>
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="blockedCountries"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Blocked Countries (Optional)</FormLabel>
                    <FormDescription>Hide this ad from users in these countries.</FormDescription>
                    <div className="flex flex-wrap gap-2 pt-2 min-h-[2.5rem]">
                      {field.value?.map((code, index) => {
                        const country = countries.find(c => c.code === code) || { name: code };
                        return (
                          <Badge key={index} variant="destructive">
                            {country.name}
                            <button type="button" onClick={() => field.onChange(field.value?.filter(c => c !== code))} className="ml-2 rounded-full hover:bg-destructive/50 p-0.5">&times;</button>
                          </Badge>
                        )
                      })}
                    </div>
                    <Sheet open={isBlockedCountrySheetOpen} onOpenChange={setIsBlockedCountrySheetOpen}>
                      <SheetTrigger asChild>
                        <Button type="button" variant="outline" className="w-full">
                          <Edit className="mr-2 h-4 w-4" /> Select Blocked Countries
                        </Button>
                      </SheetTrigger>
                      <SheetContent className="flex flex-col">
                        <SheetHeader><SheetTitle>Select Countries</SheetTitle></SheetHeader>
                        <Input placeholder="Search countries..." value={countrySearchTerm} onChange={(e) => setCountrySearchTerm(e.target.value)} />
                        <ScrollArea className="flex-grow rounded-md border">
                          <div className="p-4 space-y-1">
                            {countries.filter(c => c.name.toLowerCase().includes(countrySearchTerm.toLowerCase())).map(country => (
                              <FormItem key={`block-${country.code}`} className="flex flex-row items-center space-x-3 space-y-0 p-2 rounded-md hover:bg-muted/50">
                                <FormControl>
                                  <Checkbox
                                    checked={field.value?.includes(country.code)}
                                    onCheckedChange={(checked) => {
                                      const currentSelection = field.value || [];
                                      return checked
                                        ? field.onChange([...currentSelection, country.code])
                                        : field.onChange(currentSelection.filter(c => c !== country.code));
                                    }}
                                  />
                                </FormControl>
                                <FormLabel className="font-normal w-full cursor-pointer flex items-center gap-2">
                                  <FlagIcon countryCode={country.code} /> {country.name}
                                </FormLabel>
                              </FormItem>
                            ))}
                          </div>
                        </ScrollArea>
                      </SheetContent>
                    </Sheet>
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="terms"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Terms & Conditions</FormLabel>
                  <FormControl>
                    <Textarea
                      placeholder="e.g., Payment must be made from an account with your name. No third-party payments..."
                      className="min-h-[120px]"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="offerLabel"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Offer Label (Optional)</FormLabel>
                  <FormControl>
                    <Input placeholder="e.g., Best rate on the market!" {...field} value={field.value ?? ''} />
                  </FormControl>
                  <FormDescription>A short, eye-catching label for your ad (max 30 characters).</FormDescription>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="tags"
              render={() => (
                <FormItem>
                  <div className="mb-4">
                    <FormLabel>Ad Tags</FormLabel>
                    <FormDescription>Select tags that apply to your ad.</FormDescription>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    {adTags.map((item) => (
                      <FormField
                        key={item.id}
                        control={form.control}
                        name="tags"
                        render={({ field }) => {
                          return (
                            <FormItem
                              key={item.id}
                              className="flex flex-row items-start space-x-3 space-y-0"
                            >
                              <FormControl>
                                <Checkbox
                                  checked={field.value?.includes(item.label)}
                                  onCheckedChange={(checked) => {
                                    return checked
                                      ? field.onChange([...(field.value || []), item.label])
                                      : field.onChange(
                                        field.value?.filter(
                                          (value) => value !== item.label
                                        )
                                      )
                                  }}
                                />
                              </FormControl>
                              <FormLabel className="font-normal">
                                {item.label}
                              </FormLabel>
                            </FormItem>
                          )
                        }}
                      />
                    ))}
                  </div>
                  <FormMessage />
                </FormItem>
              )}
            />

            <div className="space-y-6">
              <h3 className="font-medium text-lg">Trader Requirements</h3>
              <FormField
                control={form.control}
                name="minCompletedTrades"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Minimum Completed Trades</FormLabel>
                    <Select onValueChange={(val) => field.onChange(parseInt(val))} defaultValue={String(field.value)}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="No requirement" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {[0, 1, 2, 3, 4, 5].map(num => (
                          <SelectItem key={num} value={String(num)}>
                            {num === 0 ? "No requirement" : `${num} completed trade${num > 1 ? 's' : ''}`}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormDescription>Set a minimum number of trades a user must have completed to start a trade with you.</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>

            {balanceError && (
              <Alert variant="destructive">
                <Wallet className="h-4 w-4" />
                <AlertTitle>Insufficient Balance</AlertTitle>
                <AlertDescription>
                  {balanceError}
                  <Button asChild variant="link" className="p-0 h-auto ml-1" onClick={() => router.push('/wallets')}>
                    <Link href="/wallets">Fund your wallet</Link>
                  </Button>
                </AlertDescription>
              </Alert>
            )}

            <Button type="submit" size="lg" className="w-full md:w-auto" disabled={(!!balanceError) || form.formState.isSubmitting}>
              {form.formState.isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {ad ? 'Save Changes' : 'Create Ad'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
