"use client";

import { useState, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
import { Search, Landmark, Wallet, Smartphone, Car, CreditCard } from 'lucide-react';
import { Card, CardContent } from '../ui/card';
import { SUPPORTED_CRYPTOS } from '@/lib/constants';
import type { CryptoCurrency } from '@/lib/types';
import { useRouter } from 'next/navigation';
import { currencies } from '@/lib/currencies';
import { usePrices } from '@/context/price-context';
import {
    bankTransfers,
    onlineWallets,
    mobileMoney,
    cashPayments,
    giftCardPaymentMethods,
} from '@/lib/payment-methods';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '../ui/accordion';
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from '../ui/sheet';
import { ScrollArea } from '../ui/scroll-area';
import { useI18n } from '@/context/i18n-context';

const CryptoLogo = ({ crypto, className }: { crypto: CryptoCurrency, className?: string }) => {
    switch (crypto) {
        case 'BTC': return <BtcLogo className={className} />;
        case 'ETH': return <EthLogo className={className} />;
        case 'LTC': return <LtcLogo className={className} />;
        case 'USDT': return <UsdtLogo className={className} />;
        default: return null;
    }
}

export function BuySellForm() {
  const { t } = useI18n();
  return (
    <Card className="bg-secondary/60 border-none shadow-lg rounded-xl w-full max-w-md">
        <CardContent className="p-4 sm:p-6">
            <Tabs defaultValue="buy" className="w-full">
                <TabsList className="grid w-full grid-cols-2 bg-muted p-1 h-auto">
                    <TabsTrigger value="buy" className="py-2 text-sm data-[state=active]:bg-green-600 data-[state=active]:text-primary-foreground">{t('buySellForm.buyTab')}</TabsTrigger>
                    <TabsTrigger value="sell" className="py-2 text-sm data-[state=active]:bg-red-600 data-[state=active]:text-primary-foreground">{t('buySellForm.sellTab')}</TabsTrigger>
                </TabsList>
                <TabsContent value="buy">
                    <FormContent type="buy" />
                </TabsContent>
                 <TabsContent value="sell">
                    <FormContent type="sell" />
                </TabsContent>
            </Tabs>
      </CardContent>
    </Card>
  );
}

function FormContent({ type }: { type: 'buy' | 'sell' }) {
    const router = useRouter();
    const { t } = useI18n();
    const [crypto, setCrypto] = useState<CryptoCurrency>('BTC');
    const [fiatAmount, setFiatAmount] = useState('');
    const [fiatCurrency, setFiatCurrency] = useState('USD');
    const [cryptoAmount, setCryptoAmount] = useState('');
    const [paymentMethod, setPaymentMethod] = useState('');
    const { prices, fiatRates } = usePrices();

    const [isPaymentSheetOpen, setIsPaymentSheetOpen] = useState(false);
    const [paymentSearch, setPaymentSearch] = useState("");
    const [isFiatSheetOpen, setIsFiatSheetOpen] = useState(false);
    const [fiatSearch, setFiatSearch] = useState("");

    const allPaymentMethods = useMemo(() => [
      { category: 'Bank Transfers', methods: bankTransfers, icon: Landmark },
      { category: 'Online Wallets', methods: onlineWallets, icon: Wallet },
      { category: 'Mobile Money', methods: mobileMoney, icon: Smartphone },
      { category: 'Cash Payments', methods: cashPayments, icon: Car },
      { category: 'Gift Cards', methods: giftCardPaymentMethods, icon: CreditCard },
    ], []);

    const filteredFiats = useMemo(() => {
        return currencies.filter(c => 
            c.name.toLowerCase().includes(fiatSearch.toLowerCase()) || 
            c.code.toLowerCase().includes(fiatSearch.toLowerCase())
        );
    }, [fiatSearch]);

    const currentPrice = prices[crypto] || 0; // Price of crypto in USD

    const handleFiatChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setFiatAmount(value);
        if (value && !isNaN(parseFloat(value)) && currentPrice > 0) {
            const targetRate = fiatRates[fiatCurrency] || 1;
            const usdAmount = parseFloat(value) / targetRate;
            setCryptoAmount((usdAmount / currentPrice).toFixed(8));
        } else {
            setCryptoAmount('');
        }
    }
    
    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const params = new URLSearchParams();
        if (fiatAmount) params.set('amount', fiatAmount);
        if (fiatCurrency) params.set('fiat', fiatCurrency);
        if (crypto) params.set('coin', crypto);
        if (paymentMethod) params.set('paymentMethod', paymentMethod);

        router.push(`/${type}?${params.toString()}`);
    }

  return (
    <>
    <form onSubmit={handleSubmit} className="space-y-4 pt-6">
        <div>
            <Label className="text-xs font-medium text-muted-foreground mb-1.5 block">{t('buySellForm.coinLabel')}</Label>
            <Select value={crypto} onValueChange={(v) => setCrypto(v as CryptoCurrency)}>
                <SelectTrigger className="bg-background h-12 text-base">
                    <SelectValue>
                        <div className="flex items-center gap-2">
                            <CryptoLogo crypto={crypto} className="h-6 w-6" />
                            <span className="font-medium">{crypto}</span>
                        </div>
                    </SelectValue>
                </SelectTrigger>
                <SelectContent>
                    {SUPPORTED_CRYPTOS.map(c => (
                         <SelectItem key={c.name} value={c.name}>
                            <div className="flex items-center gap-2">
                                <CryptoLogo crypto={c.name} className="h-6 w-6" />
                                <span className="font-medium">{c.name}</span>
                            </div>
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
        
        <div>
            <Label htmlFor="fiat-amount" className="text-xs font-medium text-muted-foreground mb-1.5 block">{type === 'buy' ? t('buySellForm.haveLabel') : t('buySellForm.wantLabel')}</Label>
            <div className='flex items-center'>
              <Input id="fiat-amount" value={fiatAmount} onChange={handleFiatChange} placeholder={t('buySellForm.amountPlaceholder')} className="bg-background h-12 text-base rounded-r-none" />
               <Button type="button" variant="outline" className="bg-background h-12 w-32 rounded-l-none text-base border-l-0" onClick={() => setIsFiatSheetOpen(true)}>
                    {fiatCurrency}
                </Button>
            </div>
            {cryptoAmount && <p className="text-xs text-muted-foreground mt-1">{type === 'buy' ? t('buySellForm.getApprox') : t('buySellForm.payApprox')} {cryptoAmount} {crypto}</p>}
        </div>

        <div>
             <Label htmlFor="payment-method" className="text-xs font-medium text-muted-foreground mb-1.5 block">{t('buySellForm.paymentMethodLabel')}</Label>
             <Button type="button" variant="outline" className="w-full justify-start text-left font-normal bg-background h-12 text-base" onClick={() => setIsPaymentSheetOpen(true)}>
                {paymentMethod || t('buySellForm.allPaymentMethods')}
            </Button>
        </div>
      
      <div>
        <Button type="submit" className="w-full h-12 text-base font-semibold" size="lg">
          <Search className="mr-2 h-5 w-5" />
          {t('buySellForm.findOffers')}
        </Button>
      </div>
    </form>
     <Sheet open={isPaymentSheetOpen} onOpenChange={setIsPaymentSheetOpen}>
        <SheetContent className="flex flex-col">
            <SheetHeader>
                <SheetTitle>Filter by Payment Method</SheetTitle>
            </SheetHeader>
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search all methods..."
                    value={paymentSearch}
                    onChange={(e) => setPaymentSearch(e.target.value)}
                    className="pl-10"
                />
            </div>
            <ScrollArea className="flex-grow -mx-6">
                <div className="px-6 py-4 space-y-1">
                    <Button
                        variant="ghost"
                        className="w-full justify-start"
                        onClick={() => { setPaymentMethod(''); setIsPaymentSheetOpen(false); }}
                    >
                        All Payment Methods
                    </Button>
                    {allPaymentMethods.map(({ category, methods, icon: Icon }) => {
                        const filteredMethods = methods.filter(m => m.toLowerCase().includes(paymentSearch.toLowerCase()));
                        if (paymentSearch && filteredMethods.length === 0) return null;
                        return (
                            <Accordion type="single" collapsible key={category}>
                                <AccordionItem value={category} className="border-b-0">
                                    <AccordionTrigger className="hover:no-underline"><Icon className="mr-2 h-4 w-4" />{category}</AccordionTrigger>
                                    <AccordionContent className="pl-4">
                                        {filteredMethods.map(method => (
                                            <Button
                                                key={method}
                                                variant="ghost"
                                                className="w-full justify-start font-normal h-auto py-2"
                                                onClick={() => { setPaymentMethod(method); setIsPaymentSheetOpen(false); }}
                                            >
                                                {method}
                                            </Button>
                                        ))}
                                    </AccordionContent>
                                </AccordionItem>
                            </Accordion>
                        );
                    })}
                </div>
            </ScrollArea>
            {paymentSearch && (
                <SheetFooter>
                    <Button className="w-full" onClick={() => { setPaymentMethod(paymentSearch); setIsPaymentSheetOpen(false); }}>
                        <Search className="mr-2 h-4 w-4" />
                        Search for "{paymentSearch}"
                    </Button>
                </SheetFooter>
            )}
        </SheetContent>
      </Sheet>
    
    <Sheet open={isFiatSheetOpen} onOpenChange={setIsFiatSheetOpen}>
        <SheetContent className="flex flex-col">
            <SheetHeader>
                <SheetTitle>Select Fiat Currency</SheetTitle>
            </SheetHeader>
            <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                    placeholder="Search currency or code..."
                    value={fiatSearch}
                    onChange={(e) => setFiatSearch(e.target.value)}
                    className="pl-10"
                />
            </div>
            <ScrollArea className="flex-grow -mx-6">
                <div className="px-6 py-4 space-y-1">
                    {filteredFiats.map(currency => (
                        <Button
                            key={currency.code}
                            variant="ghost"
                            className="w-full justify-start font-normal h-auto py-2"
                            onClick={() => { setFiatCurrency(currency.code); setIsFiatSheetOpen(false); }}
                        >
                            {currency.name} ({currency.code})
                        </Button>
                    ))}
                </div>
            </ScrollArea>
        </SheetContent>
      </Sheet>
    </>
  );
}
