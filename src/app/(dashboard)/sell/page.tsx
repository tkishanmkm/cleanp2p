"use client";

import { useAuth } from "@/components/providers/auth-provider";
import { supabase } from "@/lib/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { AdCard } from "@/components/p2p/ad-card";
import { 
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { 
  Wallet, Landmark, CreditCard, Smartphone, Car, Search, 
  Loader2, ArrowDown, ArrowUp, PlusCircle, SlidersHorizontal, 
  RefreshCw, BookOpen, HelpCircle, Globe, ChevronRight, ChevronDown, Check, ShieldCheck, Clock, X, Compass
} from "lucide-react";
import { AD_TAGS } from "@/lib/constants";
import { currencies } from "@/lib/currencies";
import { countries } from "@/lib/countries";
import { Skeleton } from "@/components/ui/skeleton";
import type { P2PAd, CryptoCurrency } from "@/lib/types";
import { useState, useMemo, Suspense, useEffect, useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import Link from 'next/link';
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from '@/components/icons';
import {
    bankTransfers,
    onlineWallets,
    mobileMoney,
    cashPayments,
    giftCardPaymentMethods,
} from "@/lib/payment-methods";
import { FlagIcon } from "@/components/ui/flag-icon";
import { cn, toDate } from "@/lib/utils";
import { usePrices } from "@/context/price-context";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ActiveTradesList } from "@/components/p2p/active-trades-list";

type ExtendedCoinOption = 'ALL' | CryptoCurrency;

const COIN_CONFIG: Record<ExtendedCoinOption, { label: string; fullName: string; badgeClass: string; textClass: string }> = {
  ALL: { label: 'All Coins', fullName: 'All Coins', badgeClass: 'bg-white/20 text-white border-white/30', textClass: 'text-white' },
  BTC: { label: 'Bitcoin (BTC)', fullName: 'Bitcoin', badgeClass: 'bg-amber-500/20 text-amber-300 border-amber-400/30', textClass: 'text-amber-300' },
  USDT: { label: 'TETHER (USDT)', fullName: 'Tether', badgeClass: 'bg-emerald-500/20 text-emerald-300 border-emerald-400/30', textClass: 'text-emerald-300' },
  ETH: { label: 'Ethereum (ETH)', fullName: 'Ethereum', badgeClass: 'bg-purple-300/20 text-purple-200 border-purple-300/30', textClass: 'text-purple-200' },
  LTC: { label: 'Litecoin (LTC)', fullName: 'Litecoin', badgeClass: 'bg-sky-400/20 text-sky-200 border-sky-300/30', textClass: 'text-sky-200' },
};

// Map Currency Codes to 2-letter ISO Country Codes for accurate flag icons
const CURRENCY_TO_COUNTRY: Record<string, string> = {
  USD: 'US', EUR: 'EU', GBP: 'GB', INR: 'IN', CAD: 'CA', AUD: 'AU', JPY: 'JP',
  CNY: 'CN', BRL: 'BR', RUB: 'RU', TRY: 'TR', AED: 'AE', SAR: 'SA', ZAR: 'ZA',
  NGN: 'NG', KES: 'KE', GHS: 'GH', EGP: 'EG', PKR: 'PK', BDT: 'BD', VND: 'VN',
  THB: 'TH', IDR: 'ID', MYR: 'MY', PHP: 'PH', SGD: 'SG', MXN: 'MX', ARS: 'AR',
  CLP: 'CL', COP: 'CO', PEN: 'PE', KRW: 'KR', PLN: 'PL', SEK: 'SE', NOK: 'NO'
};

const getCountryCodeForCurrency = (currencyCode: string): string => {
  const codeUpper = currencyCode.toUpperCase();
  if (CURRENCY_TO_COUNTRY[codeUpper]) return CURRENCY_TO_COUNTRY[codeUpper];
  const found = currencies.find(c => c.code.toUpperCase() === codeUpper);
  if (found && found.countryCode) return found.countryCode;
  return codeUpper.slice(0, 2);
};

const CryptoLogo = ({ crypto, className }: { crypto: ExtendedCoinOption, className?: string }) => {
    switch (crypto) {
        case 'BTC': return <BtcLogo className={className} />;
        case 'ETH': return <EthLogo className={className} />;
        case 'LTC': return <LtcLogo className={className} />;
        case 'USDT': return <UsdtLogo className={className} />;
        default: return <Wallet className={cn("text-white", className)} />;
    }
};

function normalizeAd(raw: any): P2PAd {
  return {
    id: raw.id,
    userId: raw.user_id || raw.userId,
    publicAdId: raw.public_ad_id || raw.publicAdId || raw.id,
    adType: (raw.ad_type || raw.adType || raw.type || 'buy').toLowerCase() as 'buy' | 'sell',
    crypto: (raw.crypto || raw.coin || 'BTC') as CryptoCurrency,
    fiatCurrency: raw.fiat_currency || raw.fiatCurrency || raw.fiat || 'USD',
    rateType: raw.rate_type || raw.rateType || 'market',
    fixedRate: raw.fixed_rate ?? raw.fixedRate ?? (raw.rate_type === 'fixed' ? Number(raw.price) : undefined),
    ratePercent: raw.rate_percent ?? raw.ratePercent ?? (raw.rate_type === 'floating' || raw.rate_type === 'market' ? Number(raw.price_margin_percent ?? raw.margin ?? 0) : 0),
    minAmount: Number(raw.min_amount ?? raw.minAmount ?? raw.min_limit ?? 0),
    maxAmount: Number(raw.max_amount ?? raw.maxAmount ?? raw.max_limit ?? 0),
    paymentMethods: Array.isArray(raw.payment_methods)
      ? raw.payment_methods
      : Array.isArray(raw.paymentMethods)
      ? raw.paymentMethods
      : typeof raw.payment_methods === 'string'
      ? (raw.payment_methods.startsWith('[') ? JSON.parse(raw.payment_methods) : [raw.payment_methods])
      : [],
    offerLabel: raw.offer_label || raw.offerLabel,
    tags: Array.isArray(raw.tags) ? raw.tags : Array.isArray(raw.ad_tags) ? raw.ad_tags : [],
    terms: raw.terms || '',
    paymentTimeLimit: Number(raw.payment_time_limit ?? raw.paymentTimeLimit ?? raw.payment_window ?? 30),
    active: raw.active !== false && raw.status !== 'inactive' && raw.status !== 'INACTIVE' && raw.status !== 'DELETED',
    targetedCountries: raw.targeted_countries || raw.targetedCountries || [],
    blockedCountries: raw.blocked_countries || raw.blockedCountries || [],
    minCompletedTrades: Number(raw.min_completed_trades ?? raw.minCompletedTrades ?? 0),
    createdAt: raw.created_at || raw.createdAt,
    user: raw.user || {
      username: raw.user_display_name || raw.username || 'Trader',
      country: raw.country,
      feedbackScore: raw.feedback_score ?? 100,
      positiveFeedback: raw.positive_feedback ?? 0,
      negativeFeedback: raw.negative_feedback ?? 0,
      completedTrades: raw.completed_trades ?? 0,
      photoURL: raw.photo_url || raw.photoURL || raw.avatar_url,
      badges: raw.badges || [],
      lastActive: raw.last_active || raw.lastActive,
      isVerified: raw.is_verified ?? raw.isVerified ?? false,
    },
  };
}

function P2PMarketplaceContent() {
  const { profile: currentUserData } = useAuth();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const isBuyPage = pathname.includes('/buy');
  const targetAdType = isBuyPage ? 'sell' : 'buy';

  const [ads, setAds] = useState<P2PAd[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [adCreators, setAdCreators] = useState<Record<string, any>>({});

  const [amount, setAmount] = useState(searchParams.get('amount') || "");
  const [paymentMethod, setPaymentMethod] = useState(searchParams.get('paymentMethod') || "");
  const [selectedCoin, setSelectedCoin] = useState<ExtendedCoinOption>((searchParams.get('coin') as ExtendedCoinOption) || "ALL");
  const [selectedFiat, setSelectedFiat] = useState(searchParams.get('fiat') || "USD");
  const [selectedCountry, setSelectedCountry] = useState(searchParams.get('country') || "");
  
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentSearch, setPaymentSearch] = useState("");
  const [isFiatModalOpen, setIsFiatModalOpen] = useState(false);
  const [fiatSearch, setFiatSearch] = useState("");
  
  // Centered Modals for Country & Offer Tags
  const [isCountryDialogOpen, setIsCountryDialogOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState("");
  const [isOfferTagsDialogOpen, setIsOfferTagsDialogOpen] = useState(false);
  const [isFiltersDialogOpen, setIsFiltersDialogOpen] = useState(false);
  
  const [sortBy, setSortBy] = useState(searchParams.get('sortBy') || 'price');
  const [selectedTags, setSelectedTags] = useState<string[]>(searchParams.get('tags')?.split(',').filter(Boolean) || []);
  const [showTopRated, setShowTopRated] = useState(searchParams.get('topRated') === 'true');
  const [showVerifiedOnly, setShowVerifiedOnly] = useState(searchParams.get('verified') === 'true');
  const [showRecentlyActive, setShowRecentlyActive] = useState(searchParams.get('recentlyActive') === 'true');
  const [showAcceptable, setShowAcceptable] = useState(searchParams.get('acceptable') === 'true');
  const [rememberFilters, setRememberFilters] = useState(false);

  // Guided Tour State & Dynamic Positioning
  const [tourStep, setTourStep] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const { prices, fiatRates } = usePrices();

  useEffect(() => {
    const saved = localStorage.getItem('p2p_saved_filters');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.coin) setSelectedCoin(parsed.coin);
        if (parsed.fiat) setSelectedFiat(parsed.fiat);
        if (parsed.country) setSelectedCountry(parsed.country);
        if (parsed.paymentMethod) setPaymentMethod(parsed.paymentMethod);
        if (parsed.topRated !== undefined) setShowTopRated(parsed.topRated);
        if (parsed.verified !== undefined) setShowVerifiedOnly(parsed.verified);
      } catch (e) {
        console.error('Failed to load saved filters', e);
      }
    }
  }, []);

  const handleSaveFilters = useCallback(() => {
    if (rememberFilters) {
      const filterData = {
        coin: selectedCoin,
        fiat: selectedFiat,
        country: selectedCountry,
        paymentMethod,
        topRated: showTopRated,
        verified: showVerifiedOnly
      };
      localStorage.setItem('p2p_saved_filters', JSON.stringify(filterData));
    }
  }, [rememberFilters, selectedCoin, selectedFiat, selectedCountry, paymentMethod, showTopRated, showVerifiedOnly]);

  const handleResetFilters = () => {
    setAmount('');
    setPaymentMethod('');
    setSelectedCoin('ALL');
    setSelectedFiat('USD');
    setSelectedCountry('');
    setSortBy('price');
    setSelectedTags([]);
    setShowTopRated(false);
    setShowVerifiedOnly(false);
    setShowRecentlyActive(false);
    setShowAcceptable(false);
    setIsFiltersDialogOpen(false);
    localStorage.removeItem('p2p_saved_filters');
  };

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (amount) params.set('amount', amount); else params.delete('amount');
    if (paymentMethod) params.set('paymentMethod', paymentMethod); else params.delete('paymentMethod');
    if (selectedCoin !== 'ALL') params.set('coin', selectedCoin); else params.delete('coin');
    if (selectedFiat) params.set('fiat', selectedFiat); else params.delete('fiat');
    if (selectedCountry) params.set('country', selectedCountry); else params.delete('country');
    if (sortBy !== 'price') params.set('sortBy', sortBy); else params.delete('sortBy');
    if (selectedTags.length > 0) params.set('tags', selectedTags.join(',')); else params.delete('tags');
    if (showTopRated) params.set('topRated', 'true'); else params.delete('topRated');
    if (showVerifiedOnly) params.set('verified', 'true'); else params.delete('verified');
    if (showRecentlyActive) params.set('recentlyActive', 'true'); else params.delete('recentlyActive');
    if (showAcceptable) params.set('acceptable', 'true'); else params.delete('acceptable');
    router.replace(`${pathname}?${params.toString()}`);
    handleSaveFilters();
  }, [amount, paymentMethod, selectedCoin, selectedFiat, selectedCountry, sortBy, selectedTags, showTopRated, showVerifiedOnly, showRecentlyActive, showAcceptable, handleSaveFilters, pathname, router, searchParams]);

  const allPaymentCategories = useMemo(() => [
    { category: 'Bank Transfers', methods: bankTransfers, icon: Landmark },
    { category: 'Online Wallets', methods: onlineWallets, icon: Wallet },
    { category: 'Mobile Money', methods: mobileMoney, icon: Smartphone },
    { category: 'Cash Payments', methods: cashPayments, icon: Car },
    { category: 'Gift Cards', methods: giftCardPaymentMethods, icon: CreditCard },
  ], []);

  const fetchAds = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('p2p_ads')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;

      const normalized = (data || [])
        .map(normalizeAd)
        .filter(ad => ad.adType === targetAdType && ad.active);
      setAds(normalized);

      const creatorIds = Array.from(new Set(normalized.map((a) => a.userId).filter(Boolean)));
      if (creatorIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('*')
          .in('id', creatorIds);

        if (profiles) {
          const map: Record<string, any> = {};
          profiles.forEach((p) => {
            map[p.id] = {
              username: p.username || 'Trader',
              country: p.country,
              feedbackScore: p.feedback_score ?? 100,
              positiveFeedback: p.positive_feedback ?? 0,
              negativeFeedback: p.negative_feedback ?? 0,
              completedTrades: p.completed_trades ?? 0,
              avgReleaseTime: p.avg_release_minutes || p.avg_release_time || 'N/A',
              avgPayTime: p.avg_payment_minutes || p.avg_pay_time || 'N/A',
              photoURL: p.avatar_url || p.photo_url || `/api/media/avatar/${p.id}`,
              badges: p.badges || [],
              lastActive: p.last_seen_at || p.last_active || p.updated_at,
              createdAt: p.created_at,
              blockedUsers: p.blocked_users || [],
              isVerified: p.is_verified ?? (p.kyc_status === 'VERIFIED') ?? false,
              cryptoBalances: {
                BTC: Number(p.btc_balance || 0),
                ETH: Number(p.eth_balance || 0),
                USDT: Number(p.usdt_balance || 0),
                LTC: Number(p.ltc_balance || 0),
              },
            };
          });

          // Fetch user_wallets to get live available balances
          try {
            const { data: wallets } = await supabase
              .from('user_wallets')
              .select('user_id, asset_symbol, balance, locked_balance, available_balance')
              .in('user_id', creatorIds);

            if (wallets) {
              wallets.forEach((w) => {
                if (map[w.user_id]) {
                  const coin = (w.asset_symbol || '').toUpperCase();
                  const avail = Number(
                    w.available_balance ?? (Number(w.balance || 0) - Number(w.locked_balance || 0))
                  );
                  if (!map[w.user_id].cryptoBalances) map[w.user_id].cryptoBalances = {};
                  map[w.user_id].cryptoBalances[coin] = Math.max(0, avail);
                }
              });
            }
          } catch (wErr) {
            console.warn('Wallet balance fetch warning in sell page:', wErr);
          }

          setAdCreators(map);
        }
      }
    } catch (err) {
      console.error('Error fetching ads:', err);
    } finally {
      setIsLoading(false);
    }
  }, [targetAdType]);

  useEffect(() => {
    fetchAds();
  }, [fetchAds]);

  const filteredFiats = useMemo(() => {
    return currencies.filter(c => 
        c.name.toLowerCase().includes(fiatSearch.toLowerCase()) || 
        c.code.toLowerCase().includes(fiatSearch.toLowerCase())
    );
  }, [fiatSearch]);

  const filteredCountries = useMemo(() => {
    return countries.filter(c => 
        c.name.toLowerCase().includes(countrySearch.toLowerCase()) ||
        c.code.toLowerCase().includes(countrySearch.toLowerCase())
    );
  }, [countrySearch]);

  const filteredAds = useMemo(() => {
    if (!ads) return [];
    
    // Apply Live Creator Data and Strict Limit Balance Rule
    const updatedAds = ads.map(ad => {
      const liveCreatorData = adCreators[ad.userId];
      const mergedUser = liveCreatorData
        ? { ...ad.user, ...liveCreatorData }
        : ad.user;

      const marketUsd = prices[ad.crypto] || 0;
      const fRate = fiatRates[ad.fiatCurrency] || 1;
      const unitPrice = ad.rateType === 'fixed' && ad.fixedRate
        ? ad.fixedRate
        : marketUsd * fRate * (1 + (ad.ratePercent || 0) / 100);

      let adjustedMax = ad.maxAmount;
      let isBalanceSufficient = true;

      // Check balance rule for SELL ads (where creator sells crypto)
      if (ad.adType === 'sell' && liveCreatorData?.cryptoBalances && ad.crypto) {
        const coinSym = ad.crypto.toUpperCase();
        if (liveCreatorData.cryptoBalances[coinSym] !== undefined) {
          const availCrypto = Number(liveCreatorData.cryptoBalances[coinSym]);
          const availFiat = availCrypto * (unitPrice > 0 ? unitPrice : 1);

          // STRICT RULE:
          // 1. If seller's balance is below min limit, hide ad from other users!
          if (availFiat < ad.minAmount) {
            isBalanceSufficient = false;
          } else if (availFiat < ad.maxAmount) {
            // 2. If seller has e.g. 530$, show limit 100 to 530$!
            adjustedMax = Math.floor(availFiat * 100) / 100;
          }
          // 3. If balance >= maxAmount, show full 100 to 1000$!
        }
      }

      return {
        ...ad,
        maxAmount: adjustedMax,
        isBalanceSufficient,
        user: mergedUser,
      };
    }).filter(ad => ad.isBalanceSufficient !== false);

    const activeFiat = selectedFiat || 'USD';
    const exchangeRate = fiatRates[activeFiat] || 1;

    let result = updatedAds.filter(ad => {
      if (currentUserData) {
        if (currentUserData.blockedUsers?.includes(ad.userId)) return false;
        const adCreator = adCreators[ad.userId];
        if (adCreator?.blockedUsers?.includes(currentUserData.id)) return false;
      }
      
      const amountNum = parseFloat(amount);
      if (amount && !isNaN(amountNum)) {
        if (amountNum < ad.minAmount || amountNum > ad.maxAmount) return false;
      }
      if (paymentMethod) {
          const hasMethod = ad.paymentMethods.some(pm => pm.toLowerCase().includes(paymentMethod.toLowerCase()));
          if (!hasMethod) return false;
      }
      if (selectedCoin !== 'ALL' && ad.crypto !== selectedCoin) return false;
      if (selectedFiat && ad.fiatCurrency !== selectedFiat) return false;
      if (selectedCountry && ad.user?.country !== selectedCountry) return false;
      if (showTopRated && !ad.user?.badges?.includes('power')) return false;
      if (showVerifiedOnly && !ad.user?.isVerified) return false;
      
      if (showRecentlyActive) {
        const lastActiveDate = ad.user?.lastActive ? toDate(ad.user.lastActive) : null;
        if (!lastActiveDate || (new Date().getTime() - lastActiveDate.getTime()) > 30 * 60 * 1000) {
          return false;
        }
      }

      if (selectedTags.length > 0) {
          if (!ad.tags || !selectedTags.every(tag => ad.tags!.includes(tag))) return false;
      }
      if (showAcceptable && currentUserData) {
        if (ad.userId === currentUserData.id) return false;
        if ((ad.minCompletedTrades || 0) > (currentUserData.completedTrades || 0)) return false;
        if (ad.targetedCountries && ad.targetedCountries.length > 0 && !ad.targetedCountries.includes('all')) {
            if (!currentUserData.country || !ad.targetedCountries.includes(currentUserData.country)) return false;
        }
        if (ad.blockedCountries && ad.blockedCountries.length > 0) {
            if (currentUserData.country && ad.blockedCountries.includes(currentUserData.country)) return false;
        }
      }
      return true;
    });
    
    result.sort((a, b) => {
      if (sortBy === 'price') {
          const marketPriceA = (prices[a.crypto] || 0) * exchangeRate;
          const marketPriceB = (prices[b.crypto] || 0) * exchangeRate;
          const priceA = a.rateType === 'fixed' ? a.fixedRate! : marketPriceA * (1 + (a.ratePercent || 0) / 100);
          const priceB = b.rateType === 'fixed' ? b.fixedRate! : marketPriceB * (1 + (b.ratePercent || 0) / 100);
          return priceB - priceA; // On Sell page, higher buy prices are preferred
      }
      if (sortBy === 'rating') {
          return (b.user?.feedbackScore || 0) - (a.user?.feedbackScore || 0);
      }
      if (sortBy === 'popular') {
          return (b.user?.completedTrades || 0) - (a.user?.completedTrades || 0);
      }
      return 0;
    });

    return result;
  }, [ads, amount, paymentMethod, selectedCoin, selectedFiat, selectedCountry, showTopRated, showVerifiedOnly, showRecentlyActive, showAcceptable, selectedTags, currentUserData, sortBy, prices, fiatRates, adCreators]);
  
  const handleToggle = (page: 'buy' | 'sell') => {
    router.push(`/${page}`);
  };

  const activePriceCoin: CryptoCurrency = selectedCoin === 'ALL' ? 'BTC' : selectedCoin;
  const activeFiatCurrency = selectedFiat || 'USD';
  const rawMarketPrice = prices[activePriceCoin] || 0;
  const fiatMultiplier = fiatRates[activeFiatCurrency] || 1;
  const calculatedPrice = rawMarketPrice * fiatMultiplier;

  const marketPriceText = rawMarketPrice > 0
    ? `1 ${activePriceCoin} = ${calculatedPrice.toLocaleString('en-US', { style: 'currency', currency: activeFiatCurrency, minimumFractionDigits: 2 })}`
    : `1 ${activePriceCoin} = Fetching price...`;

  const tourSteps = [
    {
      title: "Step 1: Action Selector",
      targetId: "tour-action-toggle",
      content: "Toggle between Buy and Sell to view available market offers or create your own transaction listing.",
    },
    {
      title: "Step 2: Asset Choice",
      targetId: "tour-crypto-select",
      content: "Select from Bitcoin, Tether, Ethereum, or Litecoin. Choose your currency with auto-calculated rates.",
    },
    {
      title: "Step 3: Filter Payment Methods",
      targetId: "tour-payment-select",
      content: "Easily search through categories including Bank Transfers, Online Wallets, Mobile Money, and Gift Cards.",
    },
    {
      title: "Step 4: Advanced Filter Options",
      targetId: "tour-filter-btn",
      content: "Refine offers by specific Country, ID-Verified traders, Top-Rated badges, and Recently Active users.",
    },
    {
      title: "Step 5: Post Your Offer",
      targetId: "tour-post-btn",
      content: "Want to sell or buy on your custom terms? Click here to create your own P2P offer instantly.",
    },
    {
      title: "Step 6: Escrow Protected Trades",
      targetId: "tour-offers-list",
      content: "Browse matched offers safely. All crypto funds are held securely in Escrow until payment is validated.",
    }
  ];

  // Dynamically recalculate tooltip position next to target highlight element
  useEffect(() => {
    if (tourStep === null) return;
    const step = tourSteps[tourStep];
    const el = document.getElementById(step.targetId);
    if (el) {
      const rect = el.getBoundingClientRect();
      const topPos = rect.bottom + window.scrollY + 12;
      const leftPos = Math.min(Math.max(16, rect.left + window.scrollX), window.innerWidth - 340);
      setTooltipPos({ top: topPos, left: leftPos });
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [tourStep]);

  const currentCoinInfo = COIN_CONFIG[selectedCoin];

  return (
    <div className="min-h-screen bg-background text-foreground transition-colors duration-200">
      {/* Theme Purple Header Bar with Dark Mode Support */}
      <div className="bg-[#5D45F9] dark:bg-[#3C2BB2] text-white border-b border-purple-400/20 shadow-lg transition-colors">
        <div className="container mx-auto p-4 sm:p-6 lg:p-8">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div>
                    <div className="flex items-center gap-3">
                      <h1 className="text-2xl font-bold md:text-3xl tracking-tight">
                        Sell <span className={cn("font-extrabold", currentCoinInfo.textClass)}>{currentCoinInfo.fullName}</span>
                      </h1>
                      <span className={cn("text-xs font-semibold px-2.5 py-1 rounded-full border", currentCoinInfo.badgeClass)}>
                        {selectedCoin}
                      </span>
                    </div>
                    <p className="text-sm text-purple-100/90 mt-1 flex items-center gap-2">
                      <CryptoLogo crypto={selectedCoin} className="h-4 w-4" />
                      {marketPriceText}
                    </p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => setTourStep(0)}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium transition-all duration-200 rounded-lg shadow-sm border bg-[#5D45F9] text-white hover:bg-[#4833D8] border-transparent focus:outline-none focus:ring-2 focus:ring-[#5D45F9]/50 active:scale-[0.98]"
                    >
                      <Compass className="w-4 h-4" />
                      <span>Take a tour</span>
                    </button>
                    <Link
                      href="/academy"
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-medium transition-all duration-200 rounded-lg shadow-sm border bg-[#5D45F9] text-white hover:bg-[#4833D8] border-transparent focus:outline-none focus:ring-2 focus:ring-[#5D45F9]/50 active:scale-[0.98]"
                    >
                      <Compass className="w-4 h-4" />
                      <span>Academy</span>
                    </Link>
                </div>
            </div>

            {/* Solid Adaptive Filter Header Bar (White in Light Mode, Dark Slate in Dark Mode) */}
            <div className="mt-6">
              <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-slate-100 p-3 shadow-xl transition-colors">
                <div className="flex flex-wrap items-center gap-2.5">
                    {/* Buy/Sell Switcher */}
                    <div 
                      id="tour-action-toggle"
                      className={cn(
                        "flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-lg border border-slate-200 dark:border-slate-700 transition-all duration-300", 
                        tourStep === 0 && "ring-4 ring-amber-400 scale-105 shadow-2xl z-50"
                      )}
                    >
                        <Button 
                          size="sm" 
                          onClick={() => handleToggle('buy')} 
                          className={cn('flex-1 text-xs font-semibold px-4 transition-all', isBuyPage ? 'bg-emerald-500 hover:bg-emerald-400 text-white shadow-md' : 'bg-transparent text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white')}
                        >
                            <ArrowDown className="mr-1 h-3.5 w-3.5" /> Buy
                        </Button>
                        <Button 
                          size="sm" 
                          onClick={() => handleToggle('sell')} 
                          className={cn('flex-1 text-xs font-semibold px-4 transition-all', !isBuyPage ? 'bg-rose-500 hover:bg-rose-400 text-white shadow-md' : 'bg-transparent text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white')}
                        >
                            <ArrowUp className="mr-1 h-3.5 w-3.5" /> Sell
                        </Button>
                    </div>

                    {/* Crypto Asset Selector */}
                    <div 
                      id="tour-crypto-select"
                      className={cn("w-full sm:w-48 transition-all duration-300", tourStep === 1 && "ring-4 ring-amber-400 scale-105 shadow-2xl z-50 rounded-md")}
                    >
                      <Select value={selectedCoin} onValueChange={(v) => setSelectedCoin(v as ExtendedCoinOption)}>
                          <SelectTrigger className="h-10 bg-slate-50 dark:bg-slate-800/80 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100">
                              <SelectValue>
                                  <div className="flex items-center gap-2">
                                      <CryptoLogo crypto={selectedCoin} className="h-5 w-5 text-slate-700 dark:text-white" />
                                      <span className="font-medium text-slate-900 dark:text-white">
                                        {COIN_CONFIG[selectedCoin].label}
                                      </span>
                                  </div>
                              </SelectValue>
                          </SelectTrigger>
                          <SelectContent className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white">
                              <SelectItem value="ALL">
                                <div className="flex items-center gap-2">
                                  <Wallet className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                                  <span>All Coins</span>
                                </div>
                              </SelectItem>
                              <SelectItem value="BTC">
                                <div className="flex items-center gap-2">
                                  <BtcLogo className="h-4 w-4" />
                                  <span className="text-amber-600 dark:text-amber-300 font-medium">Bitcoin (BTC)</span>
                                </div>
                              </SelectItem>
                              <SelectItem value="USDT">
                                <div className="flex items-center gap-2">
                                  <UsdtLogo className="h-4 w-4" />
                                  <span className="text-emerald-600 dark:text-emerald-300 font-medium">TETHER (USDT)</span>
                                </div>
                              </SelectItem>
                              <SelectItem value="ETH">
                                <div className="flex items-center gap-2">
                                  <EthLogo className="h-4 w-4" />
                                  <span className="text-purple-600 dark:text-purple-200 font-medium">Ethereum (ETH)</span>
                                </div>
                              </SelectItem>
                              <SelectItem value="LTC">
                                <div className="flex items-center gap-2">
                                  <LtcLogo className="h-4 w-4" />
                                  <span className="text-sky-600 dark:text-sky-200 font-medium">Litecoin (LTC)</span>
                                </div>
                              </SelectItem>
                          </SelectContent>
                      </Select>
                    </div>
                    
                    {/* Amount & Fiat Input with Correct Dynamic Flag Icons */}
                    <div className="relative flex items-center flex-1 min-w-[200px]">
                        <Input 
                          placeholder="Amount" 
                          value={amount} 
                          onChange={(e) => setAmount(e.target.value)} 
                          className="h-10 pl-3 pr-28 bg-slate-50 dark:bg-slate-800/80 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white placeholder:text-slate-400"
                        />
                        <Button 
                          type="button" 
                          variant="ghost" 
                          className="absolute right-1 h-8 px-2 rounded bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-900 dark:text-white text-xs font-semibold flex items-center gap-1.5 transition-colors"
                          onClick={() => setIsFiatModalOpen(true)}
                        >
                            <FlagIcon countryCode={getCountryCodeForCurrency(selectedFiat || 'USD')} className="h-3.5 w-3.5 rounded-sm" />
                            <span>{selectedFiat || 'USD'}</span>
                            <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                        </Button>
                    </div>
                    
                    {/* Payment Method Selector */}
                    <div 
                      id="tour-payment-select"
                      className={cn("flex-1 min-w-[200px] transition-all duration-300", tourStep === 2 && "ring-4 ring-amber-400 scale-105 shadow-2xl z-50 rounded-md")}
                    >
                      <Button 
                        type="button" 
                        variant="outline" 
                        className="h-10 w-full flex justify-between items-center text-left font-normal bg-slate-50 dark:bg-slate-800/80 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700" 
                        onClick={() => setIsPaymentModalOpen(true)}
                      >
                          <span className="truncate">{paymentMethod || 'All Payment Methods'}</span>
                          <ChevronDown className="h-4 w-4 opacity-60 flex-shrink-0 ml-2" />
                      </Button>
                    </div>
                    
                    <div className="flex items-center gap-2 ml-auto">
                        <Button 
                          id="tour-post-btn"
                          variant="default" 
                          asChild 
                          className={cn("bg-emerald-500 hover:bg-emerald-400 text-white border-0 shadow-md font-semibold transition-all duration-300", tourStep === 4 && "ring-4 ring-amber-400 scale-105 shadow-2xl z-50")}
                        >
                            <Link href="/ads/create"><PlusCircle className="mr-2 h-4 w-4" /> Post Offer</Link>
                        </Button>
                        <Button 
                          id="tour-filter-btn"
                          variant="outline" 
                          size="icon" 
                          onClick={() => setIsFiltersDialogOpen(true)} 
                          className={cn("bg-slate-50 dark:bg-slate-800/80 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition-all duration-300", tourStep === 3 && "ring-4 ring-amber-400 scale-105 shadow-2xl z-50")}
                        >
                            <SlidersHorizontal className="h-4 w-4" />
                        </Button>
                        <Button variant="outline" size="icon" onClick={() => fetchAds()} className="bg-slate-50 dark:bg-slate-800/80 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-700">
                            <RefreshCw className="h-4 w-4" />
                        </Button>
                    </div>
                </div>
              </Card>
            </div>
        </div>
      </div>
      
      {/* Active Trades & Feed */}
      <div className="container mx-auto px-4 sm:px-6 lg:px-8 mt-6">
        <ActiveTradesList />

        {/* Offers Feed */}
        <div 
          id="tour-offers-list"
          className={cn("bg-card text-card-foreground rounded-xl border border-border p-4 sm:p-6 shadow-sm transition-all duration-300", tourStep === 5 && "ring-4 ring-amber-400 scale-[1.01] shadow-2xl z-40")}
        >
          <div className="flex justify-between items-center mb-6 border-b border-border pb-4">
              <div>
                <h2 className="text-xl font-bold text-foreground">
                  Available Offers to Sell {currentCoinInfo.fullName}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">Showing live competitive rates from verified buyers</p>
              </div>
              <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground hidden sm:inline">Sort:</span>
                  <Select value={sortBy} onValueChange={setSortBy}>
                    <SelectTrigger className="w-[130px] h-8 text-xs bg-background border-input">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="price">Best Price</SelectItem>
                      <SelectItem value="rating">User Rating</SelectItem>
                      <SelectItem value="popular">Most Trades</SelectItem>
                    </SelectContent>
                  </Select>
              </div>
          </div>
          
          <div className="space-y-3">
              {isLoading && (
                  <div className="space-y-3">
                    <Skeleton className="h-24 w-full rounded-lg" />
                    <Skeleton className="h-24 w-full rounded-lg" />
                    <Skeleton className="h-24 w-full rounded-lg" />
                  </div>
              )}
              {!isLoading && filteredAds && filteredAds.length > 0 && (
                  filteredAds.map((ad) => (
                    <AdCard key={ad.id} ad={ad} />
                  ))
              )}
              {!isLoading && (!filteredAds || filteredAds.length === 0) && (
                  <div className="text-center py-16 border-2 border-dashed border-border rounded-xl bg-muted/20">
                      <Wallet className="mx-auto h-12 w-12 text-muted-foreground" />
                      <h3 className="mt-4 text-lg font-semibold text-foreground">No Offers Found</h3>
                      <p className="mt-1 text-sm text-muted-foreground max-w-md mx-auto">
                        No active trade offers match your search criteria. Try relaxing your payment or amount filters.
                      </p>
                      <Button variant="outline" className="mt-4" onClick={handleResetFilters}>
                        Reset All Filters
                      </Button>
                  </div>
              )}
          </div>
        </div>

        {/* How to Sell Guide Section */}
        <div className="my-12 bg-card border border-border rounded-xl p-6 sm:p-8 space-y-6 shadow-sm">
            <div className="border-b border-border pb-4">
              <h2 className="text-2xl font-bold text-foreground">
                How to Sell {currentCoinInfo.fullName}
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                Follow our step-by-step guide to sell your cryptocurrency safely using Escrow protection.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div className="space-y-2 p-4 rounded-lg bg-muted/40 border border-border">
                <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full">Step 1</span>
                <h3 className="font-semibold text-base text-foreground">Sign in & Fund Wallet</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Log in to your account and make sure your wallet is funded with crypto to sell.
                </p>
              </div>

              <div className="space-y-2 p-4 rounded-lg bg-muted/40 border border-border">
                <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full">Step 2</span>
                <h3 className="font-semibold text-base text-foreground">Filter Buyer Offers</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Select your desired payout method (Bank Transfer, Mobile Money, Cash) and currency to find matching buyer offers.
                </p>
              </div>

              <div className="space-y-2 p-4 rounded-lg bg-muted/40 border border-border">
                <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full">Step 3</span>
                <h3 className="font-semibold text-base text-foreground">Check Buyer Reputation</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Review the buyer's positive feedback score, completed trade count, and identity verification badge.
                </p>
              </div>

              <div className="space-y-2 p-4 rounded-lg bg-muted/40 border border-border">
                <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full">Step 4</span>
                <h3 className="font-semibold text-base text-foreground">Lock in Escrow</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Start the trade. Your crypto is safely locked in Escrow and cannot be claimed until you confirm receipt of payment.
                </p>
              </div>

              <div className="space-y-2 p-4 rounded-lg bg-muted/40 border border-border">
                <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full">Step 5</span>
                <h3 className="font-semibold text-base text-foreground">Verify Incoming Payment</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Verify the funds directly in your bank account, mobile money app, or wallet before releasing the crypto.
                </p>
              </div>

              <div className="space-y-2 p-4 rounded-lg bg-muted/40 border border-border">
                <span className="text-xs font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-full">Step 6</span>
                <h3 className="font-semibold text-base text-foreground">Release Crypto</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Once payment is received in full, hit "Release Crypto" to deliver the coins to the buyer and leave positive feedback.
                </p>
              </div>
            </div>
        </div>

        {/* FAQs */}
        <div className="mb-16 bg-card border border-border rounded-xl p-6 sm:p-8 shadow-sm">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-foreground">Frequently Asked Questions</h2>
              <p className="text-sm text-muted-foreground mt-1">Find answers to popular questions asked by P2P sellers.</p>
            </div>

            <Accordion type="single" collapsible className="w-full space-y-2">
              <AccordionItem value="faq-1" className="border-border">
                <AccordionTrigger className="text-foreground font-semibold">How do I get paid when selling crypto?</AccordionTrigger>
                <AccordionContent className="text-muted-foreground text-sm leading-relaxed">
                  The buyer sends funds directly to your chosen payment account (Bank account, PayPal, Wise, Mobile Money, etc.) based on your trade terms.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="faq-2" className="border-border">
                <AccordionTrigger className="text-foreground font-semibold">When should I release the crypto from Escrow?</AccordionTrigger>
                <AccordionContent className="text-muted-foreground text-sm leading-relaxed">
                  Only release crypto after logging into your bank or payment account and confirming the exact fiat payment has settled. Never release based on payment screenshots alone.
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="faq-3" className="border-border">
                <AccordionTrigger className="text-foreground font-semibold">What happens if the buyer marks as paid but hasn't sent funds?</AccordionTrigger>
                <AccordionContent className="text-muted-foreground text-sm leading-relaxed">
                  Do not release the escrow. You can open a Dispute after the timer runs down, and our moderation team will review proof and resolve the trade.
                </AccordionContent>
              </AccordionItem>
            </Accordion>
        </div>
      </div>

      {/* Payment Method Search Modal */}
      <Dialog open={isPaymentModalOpen} onOpenChange={setIsPaymentModalOpen}>
        <DialogContent className="max-w-md bg-background border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="text-foreground">Select Payment Method</DialogTitle>
          </DialogHeader>
          <div className="relative my-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search methods..." 
              value={paymentSearch} 
              onChange={(e) => setPaymentSearch(e.target.value)} 
              className="pl-10 bg-background border-input" 
            />
          </div>
          <ScrollArea className="max-h-[350px] pr-2">
            <div className="space-y-1">
              <Button 
                variant="ghost" 
                className="w-full justify-start text-foreground font-semibold" 
                onClick={() => { setPaymentMethod(''); setIsPaymentModalOpen(false); }}
              >
                All Payment Methods
              </Button>
              {allPaymentCategories.map(({ category, methods, icon: Icon }) => {
                const filtered = methods.filter(m => m.toLowerCase().includes(paymentSearch.toLowerCase()));
                if (paymentSearch && filtered.length === 0) return null;
                return (
                  <Accordion type="single" collapsible key={category}>
                    <AccordionItem value={category} className="border-b border-border">
                      <AccordionTrigger className="hover:no-underline text-foreground text-sm py-2.5">
                        <div className="flex items-center"><Icon className="mr-2 h-4 w-4 text-primary" />{category}</div>
                      </AccordionTrigger>
                      <AccordionContent className="pl-4 space-y-1">
                        {filtered.map(method => (
                          <Button 
                            key={method} 
                            variant="ghost" 
                            className="w-full justify-start font-normal h-auto py-1.5 text-xs text-foreground hover:bg-muted" 
                            onClick={() => { setPaymentMethod(method); setIsPaymentModalOpen(false); }}
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
        </DialogContent>
      </Dialog>

      {/* Fiat Currency Modal with Dynamic Country Flag Icons */}
      <Dialog open={isFiatModalOpen} onOpenChange={setIsFiatModalOpen}>
        <DialogContent className="max-w-md bg-background border-border text-foreground">
          <DialogHeader>
            <DialogTitle className="text-foreground">Select Currency</DialogTitle>
          </DialogHeader>
          <div className="relative my-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search currency code or name..." 
              value={fiatSearch} 
              onChange={(e) => setFiatSearch(e.target.value)} 
              className="pl-10 bg-background border-input" 
            />
          </div>
          <ScrollArea className="max-h-[350px] pr-2">
            <div className="space-y-1">
              {filteredFiats.map(c => {
                const countryCode = getCountryCodeForCurrency(c.code);
                return (
                  <Button 
                    key={c.code} 
                    variant="ghost" 
                    className="w-full justify-start font-normal h-auto py-2 text-foreground hover:bg-muted flex items-center justify-between" 
                    onClick={() => { setSelectedFiat(c.code); setIsFiatModalOpen(false); }}
                  >
                    <div className="flex items-center gap-3">
                      <FlagIcon countryCode={countryCode} className="h-4 w-4 rounded-sm flex-shrink-0" />
                      <span className="text-sm font-medium">{c.name}</span>
                    </div>
                    <span className="font-bold text-xs text-primary bg-primary/10 px-2 py-0.5 rounded">{c.code}</span>
                  </Button>
                );
              })}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Centered Filter Modal Dialog (Appears in Screen Center) */}
      <Dialog open={isFiltersDialogOpen} onOpenChange={setIsFiltersDialogOpen}>
        <DialogContent className="max-w-lg bg-background border-border text-foreground">
            <DialogHeader className="flex flex-row items-center justify-between border-b border-border pb-3">
                <DialogTitle className="text-foreground text-lg font-bold">Filter Offers</DialogTitle>
                <Button variant="ghost" size="sm" onClick={handleResetFilters} className="text-xs h-8">Reset All</Button>
            </DialogHeader>
            <div className="py-2 space-y-5 max-h-[75vh] overflow-y-auto pr-1">
                <div className="space-y-3">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Location & Tag</Label>
                    <Button 
                      type="button" 
                      variant="outline" 
                      className="w-full justify-between font-normal bg-background border-input" 
                      onClick={() => { setIsFiltersDialogOpen(false); setIsCountryDialogOpen(true); }}
                    >
                        <span className="flex items-center gap-2">
                          {selectedCountry && <FlagIcon countryCode={selectedCountry} className="h-4 w-4" />}
                          {selectedCountry ? countries.find(c=>c.code === selectedCountry)?.name : 'Filter by Country'}
                        </span>
                        <Globe className="h-4 w-4 text-muted-foreground" />
                    </Button>
                    <Button 
                      variant="outline" 
                      className="w-full justify-between bg-background border-input"
                      onClick={() => { setIsFiltersDialogOpen(false); setIsOfferTagsDialogOpen(true); }}
                    >
                        <span>Offer Tags ({selectedTags.length})</span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    </Button>
                </div>

                <div className="space-y-4 pt-4 border-t border-border">
                    <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Trader Badges & Status</Label>
                    
                    <div className="flex items-center justify-between">
                        <div>
                            <Label htmlFor="top-rated-switch" className="cursor-pointer font-semibold text-sm">Top-Rated Traders</Label>
                            <p className="text-xs text-muted-foreground">Experienced traders with badges</p>
                        </div>
                        <Switch id="top-rated-switch" checked={showTopRated} onCheckedChange={setShowTopRated} />
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <Label htmlFor="verified-switch" className="cursor-pointer font-semibold text-sm flex items-center gap-1">
                              <ShieldCheck className="h-4 w-4 text-emerald-500" /> Verified Users Only
                            </Label>
                            <p className="text-xs text-muted-foreground">Show offers from ID-verified users</p>
                        </div>
                        <Switch id="verified-switch" checked={showVerifiedOnly} onCheckedChange={setShowVerifiedOnly} />
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <Label htmlFor="active-switch" className="cursor-pointer font-semibold text-sm flex items-center gap-1">
                              <Clock className="h-4 w-4 text-amber-500" /> Recently Active
                            </Label>
                            <p className="text-xs text-muted-foreground">Traders active in last 30 mins</p>
                        </div>
                        <Switch id="active-switch" checked={showRecentlyActive} onCheckedChange={setShowRecentlyActive} />
                    </div>

                    <div className="flex items-center justify-between">
                        <div>
                            <Label htmlFor="acceptable-switch" className="cursor-pointer font-semibold text-sm">Acceptable Only</Label>
                            <p className="text-xs text-muted-foreground">Offers matching your wallet & limits</p>
                        </div>
                        <Switch id="acceptable-switch" checked={showAcceptable} onCheckedChange={setShowAcceptable} />
                    </div>
                </div>

                <div className="pt-4 border-t border-border space-y-3">
                    <div className="flex items-center space-x-2">
                        <Checkbox 
                          id="remember-filters" 
                          checked={rememberFilters} 
                          onCheckedChange={(checked) => setRememberFilters(!!checked)} 
                        />
                        <Label htmlFor="remember-filters" className="text-xs cursor-pointer">Remember my filters for next visit</Label>
                    </div>
                    <Button className="w-full bg-[#5D45F9] hover:bg-[#4833D8] text-white font-semibold" onClick={() => setIsFiltersDialogOpen(false)}>
                      Apply Filters
                    </Button>
                </div>
            </div>
        </DialogContent>
      </Dialog>

      {/* Offer Tags Centered Modal Dialog */}
      <Dialog open={isOfferTagsDialogOpen} onOpenChange={setIsOfferTagsDialogOpen}>
        <DialogContent className="max-w-md bg-background border-border text-foreground">
            <DialogHeader>
                <DialogTitle className="text-foreground">Filter by Offer Tags</DialogTitle>
            </DialogHeader>
            <div className="py-2 space-y-2 max-h-[350px] overflow-y-auto pr-1">
                {AD_TAGS.map((tag) => (
                    <div key={tag} className="flex items-center space-x-3 p-2 rounded-lg hover:bg-muted/50 border border-transparent">
                        <Checkbox
                            id={`tag-${tag}`}
                            checked={selectedTags.includes(tag)}
                            onCheckedChange={(checked) => {
                                return checked
                                ? setSelectedTags([...selectedTags, tag])
                                : setSelectedTags(selectedTags.filter(t => t !== tag))
                            }}
                        />
                        <Label htmlFor={`tag-${tag}`} className="font-normal cursor-pointer w-full text-foreground">{tag}</Label>
                    </div>
                ))}
            </div>
            <div className="pt-3 border-t border-border">
                <Button onClick={() => setIsOfferTagsDialogOpen(false)} className="w-full bg-[#5D45F9] hover:bg-[#4833D8] text-white font-semibold">Done</Button>
            </div>
        </DialogContent>
      </Dialog>

      {/* Country Selection Centered Modal Dialog */}
      <Dialog open={isCountryDialogOpen} onOpenChange={setIsCountryDialogOpen}>
        <DialogContent className="max-w-md bg-background border-border text-foreground">
            <DialogHeader>
              <DialogTitle className="text-foreground">Select Country</DialogTitle>
            </DialogHeader>
            <div className="relative my-2">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Search country..." value={countrySearch} onChange={(e) => setCountrySearch(e.target.value)} className="pl-10 bg-background border-input" />
            </div>
            <ScrollArea className="max-h-[350px] pr-2">
                <div className="space-y-1">
                    <Button variant="ghost" className="w-full justify-start text-foreground" onClick={() => { setSelectedCountry(''); setIsCountryDialogOpen(false); }}>
                      <Globe className="h-4 w-4 mr-2 text-muted-foreground" /> All Countries
                    </Button>
                    {filteredCountries.map(country => (
                        <Button 
                          key={country.code} 
                          variant="ghost" 
                          className="w-full justify-start font-normal h-auto py-2 flex items-center gap-3 text-foreground hover:bg-muted" 
                          onClick={() => { setSelectedCountry(country.code); setIsCountryDialogOpen(false); }}
                        >
                            <FlagIcon countryCode={country.code} className="h-4 w-4" />
                            <span>{country.name}</span>
                            <span className="ml-auto text-xs text-muted-foreground">{country.code}</span>
                        </Button>
                    ))}
                </div>
            </ScrollArea>
        </DialogContent>
      </Dialog>

      {/* Guided Tour Tooltip Card (Completely Solid - Zero Glass Effect) */}
      {tourStep !== null && (
        <>
          <div 
            className="fixed inset-0 bg-black/50 z-40 transition-opacity" 
            onClick={() => setTourStep(null)}
          />
          <div 
            style={{ top: `${tooltipPos.top}px`, left: `${tooltipPos.left}px` }}
            className="absolute z-50 w-[320px] sm:w-[360px] bg-white dark:bg-slate-900 border-2 border-[#5D45F9] text-slate-900 dark:text-slate-100 rounded-xl shadow-2xl p-4 animate-in fade-in duration-200"
          >
            <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
              <span className="text-xs font-bold text-white bg-[#5D45F9] px-2.5 py-0.5 rounded-full">
                Step {tourStep + 1} of {tourSteps.length}
              </span>
              <button 
                onClick={() => setTourStep(null)}
                className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 p-1 rounded-md transition-colors"
                aria-label="Exit tour"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <h3 className="text-base font-bold mt-2 text-slate-900 dark:text-white">
              {tourSteps[tourStep].title}
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed my-2">
              {tourSteps[tourStep].content}
            </p>
            <div className="flex justify-between items-center mt-4 pt-2 border-t border-slate-200 dark:border-slate-800">
              <Button 
                variant="outline" 
                size="sm" 
                disabled={tourStep === 0} 
                onClick={() => setTourStep(prev => (prev !== null && prev > 0 ? prev - 1 : prev))}
                className="h-8 text-xs border-slate-300 dark:border-slate-700"
              >
                Previous
              </Button>
              {tourStep < tourSteps.length - 1 ? (
                <Button size="sm" className="bg-[#5D45F9] hover:bg-[#4833D8] text-white h-8 text-xs font-semibold" onClick={() => setTourStep(prev => (prev !== null ? prev + 1 : prev))}>
                  Next Step
                </Button>
              ) : (
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white h-8 text-xs font-semibold" onClick={() => setTourStep(null)}>
                  <Check className="mr-1 h-3.5 w-3.5" /> Complete Tour
                </Button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default function P2PMarketplaceSellPage() {
    return (
        <Suspense fallback={
            <div className="flex flex-1 items-center justify-center min-h-screen bg-background">
                <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
        }>
            <P2PMarketplaceContent />
        </Suspense>
    );
}
