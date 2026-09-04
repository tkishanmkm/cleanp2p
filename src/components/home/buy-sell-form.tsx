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
import { 
  Search, 
  Landmark, 
  Wallet, 
  Smartphone, 
  Car, 
  CreditCard, 
  Globe, 
  Check, 
  X, 
  ChevronDown,
  Layers,
  ArrowRight
} from 'lucide-react';
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
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { ScrollArea } from '../ui/scroll-area';
import { useI18n } from '@/context/i18n-context';
import { FlagIcon } from '@/components/ui/flag-icon';
import { cn } from '@/lib/utils';

const CURRENCY_TO_FLAG: Record<string, string> = {
  USD: 'us', EUR: 'eu', GBP: 'gb', INR: 'in', CAD: 'ca', AUD: 'au', JPY: 'jp',
  CNY: 'cn', BRL: 'br', RUB: 'ru', TRY: 'tr', AED: 'ae', SAR: 'sa', ZAR: 'za',
  NGN: 'ng', KES: 'ke', GHS: 'gh', EGP: 'eg', PKR: 'pk', BDT: 'bd', VND: 'vn',
  THB: 'th', IDR: 'id', MYR: 'my', PHP: 'ph', SGD: 'sg', MXN: 'mx', ARS: 'ar',
  CHF: 'ch', NZD: 'nz', SEK: 'se', KRW: 'kr', NOK: 'no', PLN: 'pl', COP: 'co'
};

const getFlagCode = (currencyCode: string) =>
  CURRENCY_TO_FLAG[currencyCode.toUpperCase()] || currencyCode.slice(0, 2).toLowerCase();

const CryptoLogo = ({ crypto, className }: { crypto: CryptoCurrency; className?: string }) => {
  switch (crypto) {
    case 'BTC': return <BtcLogo className={className} />;
    case 'ETH': return <EthLogo className={className} />;
    case 'LTC': return <LtcLogo className={className} />;
    case 'USDT': return <UsdtLogo className={className} />;
    default: return null;
  }
};

export function BuySellForm() {
  const { t } = useI18n();
  return (
    <Card className="bg-card text-card-foreground border border-border shadow-xl rounded-2xl w-full max-w-md overflow-hidden transition-all">
      <CardContent className="p-4 sm:p-6">
        <Tabs defaultValue="buy" className="w-full">
          <TabsList className="grid w-full grid-cols-2 bg-slate-100 dark:bg-slate-800/80 p-1.5 h-auto rounded-xl">
            <TabsTrigger
              value="buy"
              className="py-2.5 text-sm font-semibold rounded-lg data-[state=active]:bg-[#5B4DF6] data-[state=active]:text-white data-[state=active]:shadow-md transition-all"
            >
              {t('buySellForm.buyTab') || 'Buy Crypto'}
            </TabsTrigger>
            <TabsTrigger
              value="sell"
              className="py-2.5 text-sm font-semibold rounded-lg data-[state=active]:bg-rose-600 data-[state=active]:text-white data-[state=active]:shadow-md transition-all"
            >
              {t('buySellForm.sellTab') || 'Sell Crypto'}
            </TabsTrigger>
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

  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentSearch, setPaymentSearch] = useState('');
  const [isFiatModalOpen, setIsFiatModalOpen] = useState(false);
  const [fiatSearch, setFiatSearch] = useState('');

  const allPaymentMethods = useMemo(
    () => [
      { category: 'Bank Transfers', methods: bankTransfers, icon: Landmark },
      { category: 'Online Wallets', methods: onlineWallets, icon: Wallet },
      { category: 'Mobile Money', methods: mobileMoney, icon: Smartphone },
      { category: 'Cash Payments', methods: cashPayments, icon: Car },
      { category: 'Gift Cards', methods: giftCardPaymentMethods, icon: CreditCard },
    ],
    []
  );

  const filteredFiats = useMemo(() => {
    return currencies.filter(
      (c) =>
        c.name.toLowerCase().includes(fiatSearch.toLowerCase()) ||
        c.code.toLowerCase().includes(fiatSearch.toLowerCase())
    );
  }, [fiatSearch]);

  const currentPrice = prices[crypto] || 0;

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
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const params = new URLSearchParams();
    if (fiatAmount) params.set('amount', fiatAmount);
    if (fiatCurrency) params.set('fiat', fiatCurrency);
    if (crypto) params.set('coin', crypto);
    if (paymentMethod) params.set('paymentMethod', paymentMethod);

    router.push(`/${type}?${params.toString()}`);
  };

  const selectedFiatObj = currencies.find((c) => c.code === fiatCurrency);

  return (
    <>
      <form onSubmit={handleSubmit} className="space-y-4 pt-5">
        {/* Coin Selection */}
        <div>
          <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 block">
            {t('buySellForm.coinLabel') || 'Coin'}
          </Label>
          <Select value={crypto} onValueChange={(v) => setCrypto(v as CryptoCurrency)}>
            <SelectTrigger className="bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 h-12 text-base rounded-xl">
              <SelectValue>
                <div className="flex items-center gap-2.5">
                  <CryptoLogo crypto={crypto} className="h-6 w-6" />
                  <span className="font-semibold text-slate-900 dark:text-white">{crypto}</span>
                </div>
              </SelectValue>
            </SelectTrigger>
            <SelectContent className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 rounded-xl shadow-xl">
              {SUPPORTED_CRYPTOS.map((c) => (
                <SelectItem key={c.name} value={c.name} className="py-2.5">
                  <div className="flex items-center gap-2.5">
                    <CryptoLogo crypto={c.name} className="h-6 w-6" />
                    <span className="font-medium text-slate-900 dark:text-white">{c.name}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Amount & Fiat Selection */}
        <div>
          <Label htmlFor="fiat-amount" className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 block">
            {type === 'buy' ? t('buySellForm.haveLabel') || 'I Want to Spend' : t('buySellForm.wantLabel') || 'I Want to Receive'}
          </Label>
          <div className="flex items-center">
            <Input
              id="fiat-amount"
              type="number"
              value={fiatAmount}
              onChange={handleFiatChange}
              placeholder={t('buySellForm.amountPlaceholder') || 'Enter amount'}
              className="bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 h-12 text-base rounded-l-xl rounded-r-none focus-visible:ring-[#5B4DF6]"
            />
            <Button
              type="button"
              variant="outline"
              className="bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700 h-12 px-3.5 rounded-l-none rounded-r-xl border-l-0 text-sm font-semibold flex items-center gap-2 shrink-0 hover:bg-slate-200/80 dark:hover:bg-slate-700"
              onClick={() => setIsFiatModalOpen(true)}
            >
              <div className="w-5 h-3.5 rounded-[2px] overflow-hidden flex items-center justify-center border border-black/10">
                <FlagIcon countryCode={getFlagCode(fiatCurrency)} className="w-full h-full object-cover" />
              </div>
              <span>{fiatCurrency}</span>
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            </Button>
          </div>
          {cryptoAmount && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 flex items-center gap-1 font-medium">
              <span>{type === 'buy' ? t('buySellForm.getApprox') || 'You will receive ~' : t('buySellForm.payApprox') || 'You will give ~'}</span>
              <span className="text-[#5B4DF6] dark:text-indigo-400 font-bold">{cryptoAmount} {crypto}</span>
            </p>
          )}
        </div>

        {/* Payment Method Selector */}
        <div>
          <Label htmlFor="payment-method" className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5 block">
            {t('buySellForm.paymentMethodLabel') || 'Pay With'}
          </Label>
          <Button
            type="button"
            variant="outline"
            className="w-full justify-between text-left font-normal bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 h-12 text-sm rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
            onClick={() => setIsPaymentModalOpen(true)}
          >
            <div className="flex items-center gap-2.5 truncate">
              <CreditCard className="h-4 w-4 text-[#5B4DF6] shrink-0" />
              <span className="font-medium text-slate-900 dark:text-white truncate">
                {paymentMethod || t('buySellForm.allPaymentMethods') || 'All Payment Methods'}
              </span>
            </div>
            <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0 ml-2" />
          </Button>
        </div>

        {/* Primary CTA: Find Offers */}
        <div className="pt-2">
          <Button
            type="submit"
            className="w-full h-12 text-base font-bold rounded-xl shadow-lg bg-gradient-to-r from-[#5B4DF6] via-[#6366F1] to-[#3B82F6] hover:opacity-95 text-white shadow-indigo-500/25 transition-all duration-200 flex items-center justify-center gap-2 group cursor-pointer"
            size="lg"
          >
            <Search className="h-5 w-5 transition-transform group-hover:scale-110" />
            <span>Find Offers</span>
          </Button>
        </div>
      </form>

      {/* CENTERED MODAL: Fiat Currency Selection */}
      <Dialog open={isFiatModalOpen} onOpenChange={setIsFiatModalOpen}>
        <DialogContent className="sm:max-w-lg max-h-[85vh] flex flex-col p-6 rounded-2xl border border-[#5B4DF6]/25 shadow-2xl bg-white dark:bg-[#151518]">
          <DialogHeader className="space-y-1 text-left pb-2">
            <DialogTitle className="text-xl font-bold flex items-center gap-2.5 text-slate-900 dark:text-white">
              <div className="w-8 h-8 rounded-lg bg-[#5B4DF6]/10 dark:bg-[#5B4DF6]/20 flex items-center justify-center text-[#5B4DF6]">
                <Globe className="w-4 h-4" />
              </div>
              <span>Select Fiat Currency</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
              Choose your local currency to calculate live conversion and filter peer-to-peer advertisements.
            </DialogDescription>
          </DialogHeader>

          {/* Search Input */}
          <div className="relative my-2">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by currency name or code (e.g. USD, EUR, INR)..."
              value={fiatSearch}
              onChange={(e) => setFiatSearch(e.target.value)}
              className="pl-10 h-11 bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 rounded-xl text-sm focus-visible:ring-[#5B4DF6]"
            />
            {fiatSearch && (
              <button
                type="button"
                onClick={() => setFiatSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Popular Fast Chips */}
          {!fiatSearch && (
            <div className="flex items-center gap-1.5 flex-wrap pb-2 pt-0.5">
              <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mr-1">Popular:</span>
              {['USD', 'EUR', 'GBP', 'INR', 'CAD', 'AUD', 'AED', 'NGN'].map((code) => {
                const isSelected = fiatCurrency === code;
                return (
                  <button
                    key={code}
                    type="button"
                    onClick={() => {
                      setFiatCurrency(code);
                      setIsFiatModalOpen(false);
                    }}
                    className={cn(
                      'text-xs px-2.5 py-1 rounded-lg border font-semibold transition-all flex items-center gap-1.5',
                      isSelected
                        ? 'bg-[#5B4DF6] text-white border-[#5B4DF6] shadow-xs'
                        : 'bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700'
                    )}
                  >
                    <div className="w-4 h-3 rounded-[2px] overflow-hidden">
                      <FlagIcon countryCode={getFlagCode(code)} className="w-full h-full object-cover" />
                    </div>
                    <span>{code}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Currency List */}
          <ScrollArea className="flex-1 max-h-[360px] pr-2 -mr-1">
            <div className="space-y-1 py-1">
              {filteredFiats.map((currency) => {
                const isSelected = fiatCurrency === currency.code;
                return (
                  <button
                    key={currency.code}
                    type="button"
                    onClick={() => {
                      setFiatCurrency(currency.code);
                      setIsFiatModalOpen(false);
                    }}
                    className={cn(
                      'w-full flex items-center justify-between p-3 rounded-xl transition-all text-left border',
                      isSelected
                        ? 'bg-[#5B4DF6]/10 dark:bg-[#5B4DF6]/20 border-[#5B4DF6]/40 text-foreground shadow-xs'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 text-foreground border-transparent'
                    )}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 h-5 rounded overflow-hidden shrink-0 shadow-xs border border-slate-200 dark:border-slate-700 flex items-center justify-center bg-muted">
                        <FlagIcon countryCode={getFlagCode(currency.code)} className="w-full h-full object-cover" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-slate-900 dark:text-white tracking-tight">
                            {currency.code}
                          </span>
                          <span className="text-xs text-slate-400 font-mono">({currency.symbol})</span>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[240px] sm:max-w-[320px]">
                          {currency.name}
                        </p>
                      </div>
                    </div>

                    {isSelected && (
                      <div className="w-6 h-6 rounded-full bg-[#5B4DF6] text-white flex items-center justify-center shrink-0 shadow-xs">
                        <Check className="w-3.5 h-3.5 stroke-[3]" />
                      </div>
                    )}
                  </button>
                );
              })}
              {filteredFiats.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No currencies found matching "{fiatSearch}"
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* CENTERED MODAL: Payment Method Selection */}
      <Dialog open={isPaymentModalOpen} onOpenChange={setIsPaymentModalOpen}>
        <DialogContent className="sm:max-w-xl max-h-[85vh] flex flex-col p-6 rounded-2xl border border-[#5B4DF6]/25 shadow-2xl bg-white dark:bg-[#151518]">
          <DialogHeader className="space-y-1 text-left pb-2">
            <DialogTitle className="text-xl font-bold flex items-center gap-2.5 text-slate-900 dark:text-white">
              <div className="w-8 h-8 rounded-lg bg-[#5B4DF6]/10 dark:bg-[#5B4DF6]/20 flex items-center justify-center text-[#5B4DF6]">
                <CreditCard className="w-4 h-4" />
              </div>
              <span>Select Payment Method</span>
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-500 dark:text-slate-400">
              Filter trading offers by your preferred payment channel or browse all available methods.
            </DialogDescription>
          </DialogHeader>

          {/* Search Input */}
          <div className="relative my-2">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search payment methods (e.g. Bank Transfer, Revolut, UPI, Zelle)..."
              value={paymentSearch}
              onChange={(e) => setPaymentSearch(e.target.value)}
              className="pl-10 h-11 bg-slate-50 dark:bg-slate-800/80 border-slate-200 dark:border-slate-700 rounded-xl text-sm focus-visible:ring-[#5B4DF6]"
            />
            {paymentSearch && (
              <button
                type="button"
                onClick={() => setPaymentSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* Top Option: All Payment Methods */}
          <div className="pt-1 pb-2">
            <button
              type="button"
              onClick={() => {
                setPaymentMethod('');
                setIsPaymentModalOpen(false);
              }}
              className={cn(
                'w-full flex items-center justify-between p-3.5 rounded-xl border transition-all text-left cursor-pointer',
                !paymentMethod
                  ? 'bg-gradient-to-r from-[#5B4DF6] to-[#3B82F6] text-white border-transparent shadow-md shadow-indigo-500/20'
                  : 'bg-slate-50 dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700 text-foreground'
              )}
            >
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center shrink-0',
                    !paymentMethod ? 'bg-white/20 text-white' : 'bg-[#5B4DF6]/10 text-[#5B4DF6]'
                  )}
                >
                  <Layers className="w-5 h-5" />
                </div>
                <div>
                  <div className="font-bold text-sm">All Payment Methods</div>
                  <div className={cn('text-xs', !paymentMethod ? 'text-white/80' : 'text-muted-foreground')}>
                    Show offers across all supported payment gateways & channels
                  </div>
                </div>
              </div>
              {!paymentMethod && <Check className="w-5 h-5 text-white stroke-[3]" />}
            </button>
          </div>

          {/* Categorized Payment Methods */}
          <ScrollArea className="flex-1 max-h-[340px] pr-2 -mr-1">
            <div className="space-y-3 py-1">
              {allPaymentMethods.map(({ category, methods, icon: Icon }) => {
                const filteredMethods = methods.filter((m) =>
                  m.toLowerCase().includes(paymentSearch.toLowerCase())
                );
                if (paymentSearch && filteredMethods.length === 0) return null;

                return (
                  <div key={category} className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-50/50 dark:bg-slate-900/40">
                    <div className="px-3.5 py-2.5 bg-slate-100/70 dark:bg-slate-800/60 flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider border-b border-slate-200/80 dark:border-slate-800/80">
                      <Icon className="w-3.5 h-3.5 text-[#5B4DF6]" />
                      <span>{category}</span>
                      <span className="ml-auto text-[11px] text-muted-foreground font-normal lowercase">
                        ({filteredMethods.length})
                      </span>
                    </div>
                    <div className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                      {filteredMethods.map((method) => {
                        const isSelected = paymentMethod === method;
                        return (
                          <button
                            key={method}
                            type="button"
                            onClick={() => {
                              setPaymentMethod(method);
                              setIsPaymentModalOpen(false);
                            }}
                            className={cn(
                              'flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium transition-all text-left border',
                              isSelected
                                ? 'bg-[#5B4DF6] text-white border-[#5B4DF6] shadow-xs'
                                : 'bg-white dark:bg-slate-800/80 hover:bg-slate-100 dark:hover:bg-slate-750 text-slate-800 dark:text-slate-200 border-slate-200/60 dark:border-slate-700/60'
                            )}
                          >
                            <span className="truncate">{method}</span>
                            {isSelected && <Check className="w-3.5 h-3.5 text-white ml-1.5 shrink-0 stroke-[3]" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              {paymentSearch && (
                <div className="pt-2">
                  <Button
                    type="button"
                    className="w-full bg-[#5B4DF6] hover:bg-[#4833D8] text-white rounded-xl"
                    onClick={() => {
                      setPaymentMethod(paymentSearch.trim());
                      setIsPaymentModalOpen(false);
                    }}
                  >
                    <Search className="mr-2 h-4 w-4" />
                    Use "{paymentSearch.trim()}" as custom payment filter
                  </Button>
                </div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </>
  );
}
