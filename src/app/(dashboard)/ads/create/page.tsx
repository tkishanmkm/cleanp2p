'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useWallet } from '@/context/wallet-context';
import { usePrices } from '@/context/price-context';
import { calculateMinimumFiatAmount, BASE_PLATFORM_USD_MINIMUM } from '@/lib/currency';
import { CryptoCurrency } from '@/lib/types';
import { toast } from 'sonner';
import { 
  Check, 
  Search, 
  X, 
  Globe, 
  Building2, 
  Wallet, 
  Smartphone, 
  Banknote, 
  Gift, 
  Plus,
  ChevronDown 
} from 'lucide-react';

const ALL_COUNTRIES = [
  { name: 'Afghanistan', code: 'af' },
  { name: 'Albania', code: 'al' },
  { name: 'Algeria', code: 'dz' },
  { name: 'Andorra', code: 'ad' },
  { name: 'Angola', code: 'ao' },
  { name: 'Antigua and Barbuda', code: 'ag' },
  { name: 'Argentina', code: 'ar' },
  { name: 'Armenia', code: 'am' },
  { name: 'Australia', code: 'au' },
  { name: 'Austria', code: 'at' },
  { name: 'Azerbaijan', code: 'az' },
  { name: 'Bahamas', code: 'bs' },
  { name: 'Bahrain', code: 'bh' },
  { name: 'Bangladesh', code: 'bd' },
  { name: 'Barbados', code: 'bb' },
  { name: 'Belarus', code: 'by' },
  { name: 'Belgium', code: 'be' },
  { name: 'Belize', code: 'bz' },
  { name: 'Benin', code: 'bj' },
  { name: 'Bhutan', code: 'bt' },
  { name: 'Bolivia', code: 'bo' },
  { name: 'Bosnia and Herzegovina', code: 'ba' },
  { name: 'Botswana', code: 'bw' },
  { name: 'Brazil', code: 'br' },
  { name: 'Brunei', code: 'bn' },
  { name: 'Bulgaria', code: 'bg' },
  { name: 'Burkina Faso', code: 'bf' },
  { name: 'Burundi', code: 'bi' },
  { name: 'Cabo Verde', code: 'cv' },
  { name: 'Cambodia', code: 'kh' },
  { name: 'Cameroon', code: 'cm' },
  { name: 'Canada', code: 'ca' },
  { name: 'Central African Republic', code: 'cf' },
  { name: 'Chad', code: 'td' },
  { name: 'Chile', code: 'cl' },
  { name: 'China', code: 'cn' },
  { name: 'Colombia', code: 'co' },
  { name: 'Comoros', code: 'km' },
  { name: 'Congo (Brazzaville)', code: 'cg' },
  { name: 'Congo (Kinshasa)', code: 'cd' },
  { name: 'Costa Rica', code: 'cr' },
  { name: 'Croatia', code: 'hr' },
  { name: 'Cuba', code: 'cu' },
  { name: 'Cyprus', code: 'cy' },
  { name: 'Czech Republic', code: 'cz' },
  { name: 'Denmark', code: 'dk' },
  { name: 'Djibouti', code: 'dj' },
  { name: 'Dominica', code: 'dm' },
  { name: 'Dominican Republic', code: 'do' },
  { name: 'Ecuador', code: 'ec' },
  { name: 'Egypt', code: 'eg' },
  { name: 'El Salvador', code: 'sv' },
  { name: 'Equatorial Guinea', code: 'gq' },
  { name: 'Eritrea', code: 'er' },
  { name: 'Estonia', code: 'ee' },
  { name: 'Eswatini', code: 'sz' },
  { name: 'Ethiopia', code: 'et' },
  { name: 'Fiji', code: 'fj' },
  { name: 'Finland', code: 'fi' },
  { name: 'France', code: 'fr' },
  { name: 'Gabon', code: 'ga' },
  { name: 'Gambia', code: 'gm' },
  { name: 'Georgia', code: 'ge' },
  { name: 'Germany', code: 'de' },
  { name: 'Ghana', code: 'gh' },
  { name: 'Greece', code: 'gr' },
  { name: 'Grenada', code: 'gd' },
  { name: 'Guatemala', code: 'gt' },
  { name: 'Guinea', code: 'gn' },
  { name: 'Guinea-Bissau', code: 'gw' },
  { name: 'Guyana', code: 'gy' },
  { name: 'Haiti', code: 'ht' },
  { name: 'Honduras', code: 'hn' },
  { name: 'Hungary', code: 'hu' },
  { name: 'Iceland', code: 'is' },
  { name: 'India', code: 'in' },
  { name: 'Indonesia', code: 'id' },
  { name: 'Iran', code: 'ir' },
  { name: 'Iraq', code: 'iq' },
  { name: 'Ireland', code: 'ie' },
  { name: 'Israel', code: 'il' },
  { name: 'Italy', code: 'it' },
  { name: 'Ivory Coast', code: 'ci' },
  { name: 'Jamaica', code: 'jm' },
  { name: 'Japan', code: 'jp' },
  { name: 'Jordan', code: 'jo' },
  { name: 'Kazakhstan', code: 'kz' },
  { name: 'Kenya', code: 'ke' },
  { name: 'Kiribati', code: 'ki' },
  { name: 'Kuwait', code: 'kw' },
  { name: 'Kyrgyzstan', code: 'kg' },
  { name: 'Laos', code: 'la' },
  { name: 'Latvia', code: 'lv' },
  { name: 'Lebanon', code: 'lb' },
  { name: 'Lesotho', code: 'ls' },
  { name: 'Liberia', code: 'lr' },
  { name: 'Libya', code: 'ly' },
  { name: 'Liechtenstein', code: 'li' },
  { name: 'Lithuania', code: 'lt' },
  { name: 'Luxembourg', code: 'lu' },
  { name: 'Madagascar', code: 'mg' },
  { name: 'Malawi', code: 'mw' },
  { name: 'Malaysia', code: 'my' },
  { name: 'Maldives', code: 'mv' },
  { name: 'Mali', code: 'ml' },
  { name: 'Malta', code: 'mt' },
  { name: 'Marshall Islands', code: 'mh' },
  { name: 'Mauritania', code: 'mr' },
  { name: 'Mauritius', code: 'mu' },
  { name: 'Mexico', code: 'mx' },
  { name: 'Micronesia', code: 'fm' },
  { name: 'Moldova', code: 'md' },
  { name: 'Monaco', code: 'mc' },
  { name: 'Mongolia', code: 'mn' },
  { name: 'Montenegro', code: 'me' },
  { name: 'Morocco', code: 'ma' },
  { name: 'Mozambique', code: 'mz' },
  { name: 'Myanmar', code: 'mm' },
  { name: 'Namibia', code: 'na' },
  { name: 'Nauru', code: 'nr' },
  { name: 'Nepal', code: 'np' },
  { name: 'Netherlands', code: 'nl' },
  { name: 'New Zealand', code: 'nz' },
  { name: 'Nicaragua', code: 'ni' },
  { name: 'Niger', code: 'ne' },
  { name: 'Nigeria', code: 'ng' },
  { name: 'North Korea', code: 'kp' },
  { name: 'North Macedonia', code: 'mk' },
  { name: 'Norway', code: 'no' },
  { name: 'Oman', code: 'om' },
  { name: 'Pakistan', code: 'pk' },
  { name: 'Palau', code: 'pw' },
  { name: 'Palestine', code: 'ps' },
  { name: 'Panama', code: 'pa' },
  { name: 'Papua New Guinea', code: 'pg' },
  { name: 'Paraguay', code: 'py' },
  { name: 'Peru', code: 'pe' },
  { name: 'Philippines', code: 'ph' },
  { name: 'Poland', code: 'pl' },
  { name: 'Portugal', code: 'pt' },
  { name: 'Qatar', code: 'qa' },
  { name: 'Romania', code: 'ro' },
  { name: 'Russia', code: 'ru' },
  { name: 'Rwanda', code: 'rw' },
  { name: 'Saint Kitts and Nevis', code: 'kn' },
  { name: 'Saint Lucia', code: 'lc' },
  { name: 'Saint Vincent and the Grenadines', code: 'vc' },
  { name: 'Samoa', code: 'ws' },
  { name: 'San Marino', code: 'sm' },
  { name: 'Sao Tome and Principe', code: 'st' },
  { name: 'Saudi Arabia', code: 'sa' },
  { name: 'Senegal', code: 'sn' },
  { name: 'Serbia', code: 'rs' },
  { name: 'Seychelles', code: 'sc' },
  { name: 'Sierra Leone', code: 'sl' },
  { name: 'Singapore', code: 'sg' },
  { name: 'Slovakia', code: 'sk' },
  { name: 'Slovenia', code: 'si' },
  { name: 'Solomon Islands', code: 'sb' },
  { name: 'Somalia', code: 'so' },
  { name: 'South Africa', code: 'za' },
  { name: 'South Korea', code: 'kr' },
  { name: 'South Sudan', code: 'ss' },
  { name: 'Spain', code: 'es' },
  { name: 'Sri Lanka', code: 'lk' },
  { name: 'Sudan', code: 'sd' },
  { name: 'Suriname', code: 'sr' },
  { name: 'Sweden', code: 'se' },
  { name: 'Switzerland', code: 'ch' },
  { name: 'Syria', code: 'sy' },
  { name: 'Taiwan', code: 'tw' },
  { name: 'Tajikistan', code: 'tj' },
  { name: 'Tanzania', code: 'tz' },
  { name: 'Thailand', code: 'th' },
  { name: 'Timor-Leste', code: 'tl' },
  { name: 'Togo', code: 'tg' },
  { name: 'Tonga', code: 'to' },
  { name: 'Trinidad and Tobago', code: 'tt' },
  { name: 'Tunisia', code: 'tn' },
  { name: 'Turkey', code: 'tr' },
  { name: 'Turkmenistan', code: 'tm' },
  { name: 'Tuvalu', code: 'tv' },
  { name: 'Uganda', code: 'ug' },
  { name: 'Ukraine', code: 'ua' },
  { name: 'United Arab Emirates', code: 'ae' },
  { name: 'United Kingdom', code: 'gb' },
  { name: 'United States', code: 'us' },
  { name: 'Uruguay', code: 'uy' },
  { name: 'Uzbekistan', code: 'uz' },
  { name: 'Vanuatu', code: 'vu' },
  { name: 'Vatican City', code: 'va' },
  { name: 'Venezuela', code: 've' },
  { name: 'Vietnam', code: 'vn' },
  { name: 'Yemen', code: 'ye' },
  { name: 'Zambia', code: 'zm' },
  { name: 'Zimbabwe', code: 'zw' }
];

const CRYPTO_OPTIONS = [
  { code: 'USDT', name: 'Tether (USDT)', logo: 'https://cryptologos.cc/logos/tether-usdt-logo.svg?v=035' },
  { code: 'BTC', name: 'Bitcoin (BTC)', logo: 'https://cryptologos.cc/logos/bitcoin-btc-logo.svg?v=035' },
  { code: 'ETH', name: 'Ethereum (ETH)', logo: 'https://cryptologos.cc/logos/ethereum-eth-logo.svg?v=035' },
  { code: 'LTC', name: 'Litecoin (LTC)', logo: 'https://cryptologos.cc/logos/litecoin-ltc-logo.svg?v=035' },
];

const FIAT_CURRENCIES = [
  { name: 'United States Dollar', code: 'USD', flag: 'us' },
  { name: 'Euro', code: 'EUR', flag: 'eu' },
  { name: 'Japanese Yen', code: 'JPY', flag: 'jp' },
  { name: 'Pound Sterling', code: 'GBP', flag: 'gb' },
  { name: 'Australian Dollar', code: 'AUD', flag: 'au' },
  { name: 'Canadian Dollar', code: 'CAD', flag: 'ca' },
  { name: 'Swiss Franc', code: 'CHF', flag: 'ch' },
  { name: 'Chinese Yuan', code: 'CNY', flag: 'cn' },
  { name: 'Hong Kong Dollar', code: 'HKD', flag: 'hk' },
  { name: 'New Zealand Dollar', code: 'NZD', flag: 'nz' },
  { name: 'Swedish Krona', code: 'SEK', flag: 'se' },
  { name: 'South Korean Won', code: 'KRW', flag: 'kr' },
  { name: 'Singapore Dollar', code: 'SGD', flag: 'sg' },
  { name: 'Norwegian Krone', code: 'NOK', flag: 'no' },
  { name: 'Mexican Peso', code: 'MXN', flag: 'mx' },
  { name: 'Indian Rupee', code: 'INR', flag: 'in' },
  { name: 'Russian Ruble', code: 'RUB', flag: 'ru' },
  { name: 'South African Rand', code: 'ZAR', flag: 'za' },
  { name: 'Turkish Lira', code: 'TRY', flag: 'tr' },
  { name: 'Brazilian Real', code: 'BRL', flag: 'br' },
  { name: 'United Arab Emirates Dirham', code: 'AED', flag: 'ae' },
  { name: 'Pakistani Rupee', code: 'PKR', flag: 'pk' },
  { name: 'Bangladeshi Taka', code: 'BDT', flag: 'bd' },
  { name: 'Nigerian Naira', code: 'NGN', flag: 'ng' },
  { name: 'Philippine Peso', code: 'PHP', flag: 'ph' },
  { name: 'Indonesian Rupiah', code: 'IDR', flag: 'id' },
  { name: 'Vietnamese Dong', code: 'VND', flag: 'vn' },
];

const PAYMENT_CATEGORIES = [
  {
    id: 'bank',
    title: 'Bank Transfers',
    icon: Building2,
    subtitle: 'Select bank transfer methods.',
    options: [
      'Bank Transfer', 'SEPA Transfer', 'SWIFT', 'UPI (Unified Payments Interface)', 
      'IMPS (Immediate Payment Service)', 'NEFT (National Electronic Funds Transfer)', 
      'RTGS (Real-Time Gross Settlement)', 'Interac e-Transfer', 'PayID', 'Osko', 
      'Pix (Brazil)', 'SPEI (Mexico)', 'CoDi (Mexico)', 'PSE (Colombia)', 
      'Transfiya (Colombia)', 'FPS (Faster Payment System)', 'Domestic wire transfer', 
      'International wire transfer', 'ACH transfer', 'EFT (Electronic Funds Transfer)', 
      'Direct debit', 'iDEAL', 'Bancontact', 'Giropay', 'EPS', 'Sofort', 'PesaLink', 
      'BLIK', 'Przelewy24', 'MB WAY', 'Bizum', 'Swish', 'TWINT', 'Paylib'
    ]
  },
  {
    id: 'wallets',
    title: 'Online Wallets',
    icon: Wallet,
    subtitle: 'Select online wallet methods.',
    options: [
      'Wise (formerly TransferWise)', 'Revolut', 'PayPal', 'Skrill', 'Neteller', 
      'Payoneer', 'Zelle', 'Venmo', 'Cash App', 'Google Pay', 'Apple Pay', 'Alipay'
    ]
  },
  {
    id: 'mobile',
    title: 'Mobile Money',
    icon: Smartphone,
    subtitle: 'Select mobile money methods.',
    options: [
      'M-Pesa', 'Airtel Money', 'MTN Mobile Money', 'Orange Money', 'Vodafone Cash', 
      'Tigo Money', 'MoMo', 'ZaloPay', 'ViettelPay', 'Paytm', 'PhonePe', 'GCash'
    ]
  },
  {
    id: 'cash',
    title: 'Cash Payments',
    icon: Banknote,
    subtitle: 'Select in-person or cash-based methods.',
    options: [
      'Cash deposit to bank', 'Cash in person', 'Western Union', 'MoneyGram', 
      'Ria Money Transfer', 'Cash by mail', 'Postal order', 'Bank draft', 'Cashier\'s check'
    ]
  },
  {
    id: 'giftcards',
    title: 'Gift Cards',
    icon: Gift,
    subtitle: 'Select gift card methods.',
    options: [
      'Amazon Gift Card', 'iTunes Gift Card', 'Google Play Gift Card', 'Steam Gift Card', 
      'PlayStation Network Gift Card', 'Xbox Gift Card', 'Nintendo eShop Gift Card', 
      'eBay Gift Card', 'Walmart Gift Card', 'Target Gift Card', 'Best Buy Gift Card', 
      'Sephora Gift Card', 'Starbucks Gift Card', 'Netflix Gift Card', 'Spotify Gift Card', 
      'Uber Gift Card', 'Lyft Gift Card', 'Airbnb Gift Card', 'Hotels.com Gift Card', 
      'Delta Air Lines Gift Card', 'Southwest Airlines Gift Card', 'American Airlines Gift Card', 
      'Vanilla Visa/Mastercard Gift Card', 'Razer Gold Gift Card', 'Roblox Gift Card', 
      'Fortnite V-Bucks Gift Card', 'Apple Gift Card'
    ]
  }
];

export default function CreateP2PAdPage() {
  const router = useRouter();
  const { balances } = useWallet();
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 1. Fetch user and subscribe to auth state changes on mount with real-time session recovery
  useEffect(() => {
    let isMounted = true;

    const checkUser = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (isMounted && session?.user) {
          setUser(session.user);
        } else {
          const { data: { user: currentUser } } = await supabase.auth.getUser();
          if (isMounted && currentUser) {
            setUser(currentUser);
          }
        }
      } catch (err) {
        console.error('Error fetching auth user:', err);
      } finally {
        if (isMounted) {
          setAuthLoading(false);
        }
      }
    };

    checkUser();

    // Listen for session changes (e.g. token refresh, login, logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (isMounted) {
        setUser(session?.user ?? null);
      }
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  // --- Pricing Context ---
  const { prices, fiatRates } = usePrices();

  // --- Form State ---
  const [adType, setAdType] = useState<'buy' | 'sell'>('buy');
  const [crypto, setCrypto] = useState('USDT');
  const [fiat, setFiat] = useState({ name: 'United States Dollar', code: 'USD', flag: 'us' });
  
  // Payment state & Payment search
  const [paymentSearch, setPaymentSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('bank');
  const [selectedPaymentMethods, setSelectedPaymentMethods] = useState<string[]>([]);
  const [customMethod, setCustomMethod] = useState('');

  // Pricing state
  const [currentMarketPrice, setCurrentMarketPrice] = useState<number>(1.0);
  const [rateType, setRateType] = useState<'market' | 'fixed'>('market');
  const [ratePercent, setRatePercent] = useState('1.5');
  const [fixedPrice, setFixedPrice] = useState('1.015');
  const [minAmount, setMinAmount] = useState('10');
  const [maxAmount, setMaxAmount] = useState('1000');
  const [paymentWindow, setPaymentWindow] = useState('30');

  // Dynamic $10 USD equivalent minimum limit for selected fiat
  const dynamicMinLimit = useMemo(() => {
    return calculateMinimumFiatAmount(10.00, fiat.code, fiatRates);
  }, [fiat.code, fiatRates]);

  // Compute base market price for any coin & fiat using live context rates
  const getBaseMarketPrice = useCallback(
    (coinSymbol: string, fiatCode: string, dbPrice?: number | null): number => {
      if (typeof dbPrice === 'number' && dbPrice > 0) {
        return dbPrice;
      }

      const coin = (coinSymbol || 'USDT').toUpperCase() as CryptoCurrency;
      const fiatUpper = (fiatCode || 'USD').toUpperCase();

      const liveUsdPrice = prices[coin] ?? (coin === 'USDT' ? 1.0 : coin === 'BTC' ? 89500 : coin === 'ETH' ? 2650 : 72);
      const liveFiatRate = fiatRates[fiatUpper] ?? (fiatUpper === 'INR' ? 95.6 : fiatUpper === 'EUR' ? 0.92 : fiatUpper === 'GBP' ? 0.78 : 1.0);

      const computed = liveUsdPrice * liveFiatRate;
      return Number(computed.toFixed(coin === 'USDT' ? 2 : 4));
    },
    [prices, fiatRates]
  );

  // Fetch Live Market Price on Mount / change and poll periodically
  // Note: fixedPrice remains completely static as specified and is NOT overwritten by market ticks!
  useEffect(() => {
    let isCancelled = false;

    const fetchMarketPrice = async () => {
      try {
        let fetchedPrice: number | null = null;

        // 1. Try public P2P market prices endpoint
        try {
          const res = await fetch(`/api/p2p/market-prices?fiat=${fiat.code}`, { cache: 'no-store' });
          if (res.ok) {
            const data = await res.json();
            if (data.prices && Array.isArray(data.prices)) {
              const matched = data.prices.find((p: any) => p.asset_symbol?.toUpperCase() === crypto?.toUpperCase());
              if (matched && typeof matched.price_in_fiat === 'number' && matched.price_in_fiat > 0) {
                fetchedPrice = matched.price_in_fiat;
              }
            }
          }
        } catch {}

        // 2. Try Supabase direct crypto_market_prices table
        if (!fetchedPrice) {
          try {
            const { data } = await supabase
              .from('crypto_market_prices')
              .select('price')
              .eq('coin', crypto || 'USDT')
              .eq('fiat', fiat.code || 'USD')
              .maybeSingle();

            if (data && typeof data.price === 'number' && data.price > 0) {
              fetchedPrice = data.price;
            }
          } catch {}
        }

        const finalPrice = getBaseMarketPrice(crypto, fiat.code, fetchedPrice);
        if (!isCancelled) {
          setCurrentMarketPrice(finalPrice);
          // If in fixed mode and fixedPrice has not been set yet, initialize it
          setFixedPrice((prev) => {
            if (!prev || prev === '0' || prev === '0.00') {
              const margin = parseFloat(ratePercent) || 0;
              return (finalPrice * (1 + margin / 100)).toFixed(2);
            }
            return prev;
          });
        }
      } catch (err) {
        console.warn('Could not fetch market price:', err);
      }
    };

    fetchMarketPrice();
    const interval = setInterval(fetchMarketPrice, 6000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [crypto, fiat.code, getBaseMarketPrice, ratePercent]);

  // Adjust min and max trade amounts when fiat currency changes to ensure $10 USD equivalent minimum is met
  useEffect(() => {
    const requiredMin = calculateMinimumFiatAmount(10.00, fiat.code, fiatRates);
    setMinAmount((prev) => {
      const currentVal = parseFloat(prev);
      if (isNaN(currentVal) || currentVal < requiredMin) {
        return String(requiredMin);
      }
      return prev;
    });
    setMaxAmount((prev) => {
      const currentVal = parseFloat(prev);
      if (isNaN(currentVal) || currentVal < requiredMin) {
        return String(requiredMin * 10);
      }
      return prev;
    });
  }, [fiat.code, fiatRates]);

  // Handler for Rate Type Switch (Market vs Fixed)
  const handleSelectRateType = (type: 'market' | 'fixed') => {
    setRateType(type);
    if (type === 'fixed') {
      // If fixedPrice is empty, set default from current market price + margin
      if (!fixedPrice || parseFloat(fixedPrice) <= 0) {
        const margin = parseFloat(ratePercent) || 0;
        const base = currentMarketPrice || getBaseMarketPrice(crypto, fiat.code);
        const autoAdjusted = (base * (1 + margin / 100)).toFixed(2);
        setFixedPrice(autoAdjusted);
      }
    }
  };

  // Flatten all payment options for global search with category info
  const allPaymentOptions = React.useMemo(() => {
    const list: { name: string; category: string }[] = [];
    PAYMENT_CATEGORIES.forEach((cat) => {
      cat.options.forEach((opt) => {
        list.push({ name: opt, category: cat.title });
      });
    });
    return list;
  }, []);

  const searchedPaymentMethods = React.useMemo(() => {
    if (!paymentSearch.trim()) return [];
    const query = paymentSearch.toLowerCase().trim();
    return allPaymentOptions.filter((item) =>
      item.name.toLowerCase().includes(query) || item.category.toLowerCase().includes(query)
    );
  }, [paymentSearch, allPaymentOptions]);

  // Country & Metadata
  const [targetedCountries, setTargetedCountries] = useState<string[]>([]);
  const [blockedCountries, setBlockedCountries] = useState<string[]>([]);
  const [terms, setTerms] = useState('');
  const [offerLabel, setOfferLabel] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [minTrades, setMinTrades] = useState('0');
  const [requireFullNameVerified, setRequireFullNameVerified] = useState(false);
  const [requireVerifiedUsers, setRequireVerifiedUsers] = useState(false);

  // Modals UI
  const [isFiatModalOpen, setIsFiatModalOpen] = useState(false);
  const [isTargetedModalOpen, setIsTargetedModalOpen] = useState(false);
  const [isBlockedModalOpen, setIsBlockedModalOpen] = useState(false);
  const [fiatSearch, setFiatSearch] = useState('');
  const [countrySearch, setCountrySearch] = useState('');

  const togglePaymentMethod = (method: string) => {
    if (selectedPaymentMethods.includes(method)) {
      setSelectedPaymentMethods(selectedPaymentMethods.filter((m) => m !== method));
    } else {
      if (selectedPaymentMethods.length >= 5) {
        toast.error('You can select a maximum of 5 payment methods.');
        return;
      }
      setSelectedPaymentMethods([...selectedPaymentMethods, method]);
    }
  };

  const addCustomPaymentMethod = () => {
    if (!customMethod.trim()) return;
    if (selectedPaymentMethods.length >= 5) {
      toast.error('You can select a maximum of 5 payment methods.');
      return;
    }
    if (!selectedPaymentMethods.includes(customMethod.trim())) {
      setSelectedPaymentMethods([...selectedPaymentMethods, customMethod.trim()]);
      setCustomMethod('');
    }
  };

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter((t) => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  // --- SUBMIT HANDLER ---
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    if (isSubmitting) return;

    // Direct Validation Checks
    if (!selectedPaymentMethods || selectedPaymentMethods.length === 0) {
      toast.error('Please select at least 1 payment method.');
      return;
    }

    if (rateType === 'fixed' && (!fixedPrice || parseFloat(fixedPrice) <= 0)) {
      toast.error('Please enter a valid fixed price.');
      return;
    }

    // Enforce dynamic $10 USD equivalent minimum trade limit
    const minRequired = calculateMinimumFiatAmount(10.00, fiat.code, fiatRates);
    if (!minAmount || parseFloat(minAmount) < minRequired) {
      toast.error(`Minimum trade limit must be at least ${minRequired} ${fiat.code} (equivalent to $10.00 USD).`);
      return;
    }

    if (!maxAmount || parseFloat(minAmount) > parseFloat(maxAmount)) {
      toast.error('Invalid trade limits: Minimum amount must be less than maximum amount.');
      return;
    }

    // BALANCE CHECK: If creating a Sell ad, verify available coin balance against minimum limit
    const activePricingType = rateType === 'fixed' ? 'FIXED' : 'FLOAT';
    const activeMarketPrice = currentMarketPrice || getBaseMarketPrice(crypto, fiat.code);
    const activeMarginPercentage = isNaN(parseFloat(ratePercent)) ? 0 : parseFloat(ratePercent);
    const effectiveAdPrice = activePricingType === 'FLOAT'
      ? activeMarketPrice * (1 + (activeMarginPercentage / 100))
      : Number(fixedPrice || 1);

    if (adType === 'sell') {
      let availableBalance = balances[crypto as CryptoCurrency]?.available || 0;
      const minCoinRequired = (parseFloat(minAmount || '0') || 0) / (effectiveAdPrice || 1);

      if (availableBalance < minCoinRequired) {
        // Attempt fresh fetch from /api/wallet/balance in case state was stale
        try {
          const freshRes = await fetch('/api/wallet/balance');
          if (freshRes.ok) {
            const freshJson = await freshRes.json();
            const fetchedAvail = Number(freshJson?.balances?.[crypto]?.available ?? 0);
            if (fetchedAvail >= minCoinRequired) {
              availableBalance = fetchedAvail;
            }
          }
        } catch {
          // ignore network failure
        }
      }

      if (availableBalance < minCoinRequired) {
        toast.error(`Insufficient ${crypto} balance. You need at least ${minCoinRequired.toFixed(6)} ${crypto} to set a minimum limit of ${minAmount} ${fiat.code}. Available: ${availableBalance.toFixed(6)} ${crypto}.`);
        return;
      }
    }

    setIsSubmitting(true);
    const toastId = toast.loading('Publishing your advertisement...');

    try {
      // 2. Real-time session resolution
      const { data: { session: freshSession } } = await supabase.auth.getSession();
      const { data: { user: freshUser } } = await supabase.auth.getUser();
      let activeUser = freshSession?.user || freshUser || user;

      // Secondary fallback to localStorage user if present
      if (!activeUser && typeof window !== 'undefined') {
        const cached = localStorage.getItem('paxones_user') || localStorage.getItem('sb-auth-token');
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (parsed?.id || parsed?.user?.id) {
              activeUser = parsed?.user || parsed;
            }
          } catch {}
        }
      }

      if (!activeUser) {
        toast.error('No active session found! Please refresh or log in again.', { id: toastId });
        setIsSubmitting(false);
        return;
      }

      const userId = activeUser.id;
      const displayName =
        activeUser.user_metadata?.display_name ||
        activeUser.user_metadata?.full_name ||
        activeUser.email?.split('@')[0] ||
        'Trader';

      // Coin asset precision and fiat resolution
      const coinSymbol = (crypto || 'USDT').toUpperCase();
      const fiatSymbol = (fiat.code || 'USD').toUpperCase();

      // Safe calculation for market price & dynamic pricing
      const pricingType = activePricingType;
      const marketPrice = activeMarketPrice;
      const marginPercentage = activeMarginPercentage;

      const calculatedPrice = pricingType === 'FLOAT'
        ? marketPrice * (1 + (marginPercentage / 100))
        : Number(fixedPrice);

      const adPayload = {
        user_id: userId,
        type: adType.toUpperCase(), // 'BUY' or 'SELL'
        side: adType.toUpperCase(),
        coin: coinSymbol,
        asset_symbol: coinSymbol,
        crypto: coinSymbol,
        crypto_currency: coinSymbol,
        asset: coinSymbol,
        fiat: fiatSymbol,
        fiat_symbol: fiatSymbol,
        fiat_currency: fiatSymbol,
        payment_methods: Array.isArray(selectedPaymentMethods) && selectedPaymentMethods.length > 0
          ? selectedPaymentMethods
          : ['Bank Transfer'],
        pricing_type: pricingType,
        price: calculatedPrice,
        unit_price: calculatedPrice,
        min_amount: Number(minAmount),
        max_amount: Number(maxAmount),
        min_limit: Number(minAmount),
        max_limit: Number(maxAmount),
        total_amount: Number(maxAmount),
        available_amount: Number(maxAmount),
        status: 'active',
        user_display_name: displayName,
        ad_type: adType.toLowerCase(),
        trade_type: adType.toUpperCase(),
        rate_type: rateType,
        price_type: rateType,
        fixed_rate: rateType === 'fixed',
        is_fixed: rateType === 'fixed',
        rate_percent: rateType === 'market' ? marginPercentage : 0,
        rate_adjustment: rateType === 'market' ? marginPercentage : 0,
        margin: rateType === 'market' ? marginPercentage : 0,
        margin_percentage: marginPercentage,
        payment_window: parseInt(paymentWindow, 10) || 30,
        targeted_countries: targetedCountries || [],
        blocked_countries: blockedCountries || [],
        terms: terms || '',
        offer_label: offerLabel || '',
        tags: selectedTags || [],
        ad_tags: selectedTags || [],
        min_completed_trades: parseInt(minTrades, 10) || 0,
        require_full_name_verified: requireFullNameVerified,
        require_verified_users: requireVerifiedUsers,
      };

      // Clean payload: Cast numeric columns and ensure booleans are boolean
      const cleanPayload: Record<string, any> = {
        ...adPayload,
        price: adPayload.price ? Number(adPayload.price) : null,
        unit_price: adPayload.unit_price ? Number(adPayload.unit_price) : null,
        margin: adPayload.margin ? Number(adPayload.margin) : null,
        min_amount: adPayload.min_amount ? Number(adPayload.min_amount) : null,
        max_amount: adPayload.max_amount ? Number(adPayload.max_amount) : null,
        min_limit: adPayload.min_limit ? Number(adPayload.min_limit) : null,
        max_limit: adPayload.max_limit ? Number(adPayload.max_limit) : null,
        is_fixed: Boolean(rateType === 'fixed'),
        require_full_name_verified: Boolean(requireFullNameVerified),
        require_verified_users: Boolean(requireVerifiedUsers),
      };

      // Remove fixed_rate boolean to avoid PostgreSQL 22P02 error on numeric column
      delete cleanPayload.fixed_rate;

      // 3. Call backend API route with Bearer token & credentials: 'include'
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (freshSession?.access_token) {
        headers['Authorization'] = `Bearer ${freshSession.access_token}`;
      }

      const response = await fetch('/api/p2p/ads', {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify(cleanPayload),
      });

      let result: any = null;
      const contentType = response.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        try {
          result = await response.json();
        } catch {
          result = null;
        }
      } else {
        const textResp = await response.text();
        console.warn('Non-JSON response received:', textResp);
      }

      if (!response.ok) {
        const errorMsg = result?.realError || result?.error || result?.message || `Server returned ${response.status}`;
        console.error('Error creating ad:', errorMsg);
        toast.error(`Failed: ${errorMsg}`, { id: toastId, duration: 6000 });
        setIsSubmitting(false);
        return;
      }

      console.log('Ad created successfully:', result?.data);
      toast.success('P2P Advertisement created successfully!', { id: toastId });
      setTimeout(() => {
        router.push('/my-ads');
      }, 500);
    } catch (err: any) {
      console.error('Runtime error:', err);
      toast.error(`Unexpected error: ${err?.message || String(err)}`, { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  const filteredFiats = FIAT_CURRENCIES.filter(
    (f) =>
      f.name.toLowerCase().includes(fiatSearch.toLowerCase()) ||
      f.code.toLowerCase().includes(fiatSearch.toLowerCase())
  );

  const calculatedOfferPrice = rateType === 'market'
    ? (currentMarketPrice || 1.0) * (1 + (parseFloat(ratePercent) || 0) / 100)
    : (parseFloat(fixedPrice) > 0 ? parseFloat(fixedPrice) : (currentMarketPrice || 1.0));

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-[#0f0f12] text-gray-900 dark:text-gray-100 px-4 py-8 md:py-12 flex justify-center transition-colors">
      <div className="w-full max-w-3xl space-y-8">
        
        {/* Instruction 1: Solid #9273fc Header banner with exact text and no tag */}
        <div className="bg-[#9273fc] text-white py-8 px-6 sm:px-8 rounded-2xl shadow-lg">
          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            Create a P2P Advertisement
          </h1>
          <p className="text-sm text-white/95 mt-1 font-medium">
            Set up your custom advertisement to buy or sell coin
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-8">
          
          {/* STEP 1: Type & Crypto Selection */}
          <div className="bg-white dark:bg-[#18181c] p-5 md:p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-6 transition-colors">
            
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => setAdType('buy')}
                className={`py-3 px-4 rounded-lg font-medium text-sm transition-all border ${
                  adType === 'buy'
                    ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                    : 'bg-white dark:bg-[#202026] text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                I want to Buy
              </button>
              <button
                type="button"
                onClick={() => setAdType('sell')}
                className={`py-3 px-4 rounded-lg font-medium text-sm transition-all border ${
                  adType === 'sell'
                    ? 'bg-rose-600 text-white border-rose-600 shadow-sm'
                    : 'bg-white dark:bg-[#202026] text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                I want to Sell
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                Coin
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                {CRYPTO_OPTIONS.map((c) => {
                  const isSelected = crypto === c.code;
                  return (
                    <button
                      key={c.code}
                      type="button"
                      onClick={() => setCrypto(c.code)}
                      className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg border text-sm font-medium transition-all ${
                        isSelected
                          ? 'border-[#9273fc] bg-[#9273fc] text-white shadow-md shadow-[#9273fc]/20'
                          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <img src={c.logo} alt={c.code} className="w-5 h-5 rounded-full object-contain" />
                      <span>{c.code}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-2">
                With Fiat
              </label>
              <div className="flex items-center justify-between p-3.5 bg-gray-50 dark:bg-[#202026] border border-gray-200 dark:border-gray-700 rounded-lg">
                <div className="flex items-center gap-3">
                  <img 
                    src={`https://flagcdn.com/w40/${fiat.flag}.png`} 
                    alt={fiat.code} 
                    className="w-6 h-4 object-cover rounded-[2px]" 
                  />
                  <div>
                    <div className="text-sm font-medium text-gray-900 dark:text-white">{fiat.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">{fiat.code}</div>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsFiatModalOpen(true)}
                  className="flex items-center gap-1.5 text-xs font-medium bg-white dark:bg-[#18181c] text-gray-800 dark:text-gray-200 px-3 py-1.5 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 transition"
                >
                  <Globe className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                  Change
                </button>
              </div>
            </div>

          </div>

          {/* STEP 2: Payment Methods with Search Option */}
          <div className="bg-white dark:bg-[#18181c] p-5 md:p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-5 transition-colors">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Payment Methods</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Select up to 5 methods. Add a custom method if yours isn&apos;t listed under a category.
              </p>
            </div>

            {/* Instruction 2: Search Payment Method */}
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search payment methods (e.g. UPI, Bank Transfer, PayPal, Zelle)..."
                value={paymentSearch}
                onChange={(e) => setPaymentSearch(e.target.value)}
                className="w-full pl-9 pr-9 py-2.5 text-xs md:text-sm border border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-[#202026] text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-[#9273fc] transition"
              />
              {paymentSearch && (
                <button
                  type="button"
                  onClick={() => setPaymentSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {selectedPaymentMethods.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {selectedPaymentMethods.map((method) => (
                  <span
                    key={method}
                    className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium bg-purple-50 dark:bg-[#9273fc]/20 text-[#9273fc] dark:text-purple-300 border border-[#9273fc]/30"
                  >
                    {method}
                    <button
                      type="button"
                      onClick={() => togglePaymentMethod(method)}
                      className="hover:text-rose-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}

            {paymentSearch.trim() ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                  <span>Search Results ({searchedPaymentMethods.length})</span>
                  <button
                    type="button"
                    onClick={() => setPaymentSearch('')}
                    className="text-[#9273fc] hover:underline"
                  >
                    Clear search
                  </button>
                </div>
                {searchedPaymentMethods.length > 0 ? (
                  <div className="max-h-60 overflow-y-auto space-y-1 pr-1">
                    {searchedPaymentMethods.map((item) => {
                      const isSelected = selectedPaymentMethods.includes(item.name);
                      return (
                        <button
                          key={`${item.category}-${item.name}`}
                          type="button"
                          onClick={() => togglePaymentMethod(item.name)}
                          className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left text-xs transition ${
                            isSelected
                              ? 'bg-purple-50 dark:bg-[#9273fc]/20 text-[#9273fc] dark:text-purple-300 font-medium border border-[#9273fc]/30'
                              : 'hover:bg-gray-50 dark:hover:bg-gray-800/60 text-gray-700 dark:text-gray-300 border border-transparent'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span>{item.name}</span>
                            <span className="text-[10px] text-gray-400 dark:text-gray-500 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded">
                              {item.category}
                            </span>
                          </div>
                          {isSelected && <Check className="w-4 h-4 text-[#9273fc]" />}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="py-6 text-center text-xs text-gray-500">
                    No payment methods matching &quot;{paymentSearch}&quot;. You can add it as a custom method below!
                  </div>
                )}
              </div>
            ) : (
              <>
                <div className="flex gap-2 overflow-x-auto pb-2 border-b border-gray-100 dark:border-gray-800">
                  {PAYMENT_CATEGORIES.map((cat) => {
                    const Icon = cat.icon;
                    const active = selectedCategory === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setSelectedCategory(cat.id)}
                        className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                          active
                            ? 'bg-[#9273fc] text-white shadow-sm'
                            : 'bg-gray-50 dark:bg-[#202026] text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                        }`}
                      >
                        <Icon className="w-3.5 h-3.5" />
                        {cat.title}
                      </button>
                    );
                  })}
                </div>

                {PAYMENT_CATEGORIES.filter((c) => c.id === selectedCategory).map((cat) => (
                  <div key={cat.id} className="space-y-3 pt-1">
                    <p className="text-xs text-gray-500 dark:text-gray-400">{cat.subtitle}</p>
                    <div className="max-h-56 overflow-y-auto pr-1 space-y-1">
                      {cat.options.map((option) => {
                        const isSelected = selectedPaymentMethods.includes(option);
                        return (
                          <button
                            key={option}
                            type="button"
                            onClick={() => togglePaymentMethod(option)}
                            className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left text-xs transition ${
                              isSelected
                                ? 'bg-purple-50 dark:bg-[#9273fc]/20 text-[#9273fc] dark:text-purple-300 font-medium'
                                : 'hover:bg-gray-50 dark:hover:bg-gray-800/60 text-gray-700 dark:text-gray-300'
                            }`}
                          >
                            <span>{option}</span>
                            {isSelected && <Check className="w-4 h-4 text-[#9273fc]" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </>
            )}

            <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
              <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1.5">Add Custom Payment Method</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="e.g. Local Bank Transfer"
                  value={customMethod}
                  onChange={(e) => setCustomMethod(e.target.value)}
                  className="flex-1 px-3 py-2 text-xs border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] text-gray-900 dark:text-white rounded-lg focus:outline-none focus:ring-1 focus:ring-[#9273fc]"
                />
                <button
                  type="button"
                  onClick={addCustomPaymentMethod}
                  className="px-3 py-2 bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-lg text-xs font-medium hover:bg-gray-200 dark:hover:bg-gray-700 transition flex items-center gap-1"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add
                </button>
              </div>
            </div>
          </div>

          {/* STEP 3: Pricing & Limits with Market Rate vs Fixed Auto-Adjustment */}
          <div className="bg-white dark:bg-[#18181c] p-5 md:p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-5 transition-colors">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Pricing</h2>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => handleSelectRateType('market')}
                className={`py-2.5 px-4 rounded-lg text-xs font-medium border transition ${
                  rateType === 'market'
                    ? 'bg-[#9273fc] text-white border-[#9273fc] shadow-sm'
                    : 'bg-white dark:bg-[#202026] text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                Market Rate
              </button>
              <button
                type="button"
                onClick={() => handleSelectRateType('fixed')}
                className={`py-2.5 px-4 rounded-lg text-xs font-medium border transition ${
                  rateType === 'fixed'
                    ? 'bg-[#9273fc] text-white border-[#9273fc] shadow-sm'
                    : 'bg-white dark:bg-[#202026] text-gray-700 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800'
                }`}
              >
                Fixed Rate
              </button>
            </div>

            {rateType === 'market' ? (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                  Market Rate Adjustment
                </label>
                <div className="relative">
                  <input
                    type="number"
                    step="0.1"
                    value={ratePercent}
                    onChange={(e) => setRatePercent(e.target.value)}
                    className="w-full pl-3 pr-8 py-2.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] text-gray-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#9273fc]"
                  />
                  <span className="absolute right-3 top-3 text-xs text-gray-400 font-semibold">%</span>
                </div>
                {/* Instruction 4: Live Market Price Display */}
                <p className="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                  Your price will float with the market. Current market price is approx.{' '}
                  <span className="font-semibold text-gray-800 dark:text-gray-200">
                    {fiat.code} {currentMarketPrice ? currentMarketPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '100.00'}
                  </span>
                  . Calculated offer price:{' '}
                  <span className="font-semibold text-[#9273fc]">
                    {fiat.code} {calculatedOfferPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                  .
                  <br />
                  Set your adjustment percentage (from -50% to 50%). E.g., &apos;1.5&apos; for 1.5% above market.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Fixed Price</label>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">
                    Market base: <strong className="text-gray-700 dark:text-gray-300">{fiat.code} {currentMarketPrice ? currentMarketPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '100.00'}</strong> (+{ratePercent || '1.5'}% auto-adjusted)
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    value={fixedPrice}
                    onChange={(e) => setFixedPrice(e.target.value)}
                    className="w-full pl-3 pr-12 py-2.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] text-gray-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#9273fc]"
                  />
                  <span className="absolute right-3 top-3 text-xs text-gray-400 font-semibold">
                    {fiat.code}
                  </span>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">
                    Minimum Trade Amount
                  </label>
                  <span className="text-[11px] font-medium text-purple-600 dark:text-purple-400">
                    Min: {dynamicMinLimit.toLocaleString()} {fiat.code} ($10 USD)
                  </span>
                </div>
                <div className="relative">
                  <input
                    type="number"
                    min={dynamicMinLimit}
                    value={minAmount}
                    onChange={(e) => setMinAmount(e.target.value)}
                    className={`w-full pl-3 pr-12 py-2.5 border rounded-lg text-sm bg-white dark:bg-[#202026] text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#9273fc] ${
                      parseFloat(minAmount || '0') < dynamicMinLimit
                        ? 'border-rose-400 dark:border-rose-700 ring-1 ring-rose-400 dark:ring-rose-800'
                        : 'border-gray-200 dark:border-gray-700'
                    }`}
                  />
                  <span className="absolute right-3 top-3 text-xs text-gray-400 font-semibold">
                    {fiat.code}
                  </span>
                </div>
                {parseFloat(minAmount || '0') < dynamicMinLimit ? (
                  <div className="flex items-center justify-between mt-1 text-[11px] text-rose-500 font-medium">
                    <span>Must be at least {dynamicMinLimit.toLocaleString()} {fiat.code} ($10.00 USD)</span>
                    <button
                      type="button"
                      onClick={() => setMinAmount(String(dynamicMinLimit))}
                      className="underline text-[#9273fc] hover:text-purple-600 cursor-pointer"
                    >
                      Set to Min
                    </button>
                  </div>
                ) : (
                  <span className="text-[11px] text-gray-400 mt-1 block">
                    Equivalent to ≥ ${BASE_PLATFORM_USD_MINIMUM.toFixed(2)} USD in {fiat.code}.
                  </span>
                )}
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Maximum Trade Amount
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={maxAmount}
                    onChange={(e) => setMaxAmount(e.target.value)}
                    className="w-full pl-3 pr-12 py-2.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] text-gray-900 dark:text-white rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-[#9273fc]"
                  />
                  <span className="absolute right-3 top-3 text-xs text-gray-400 font-semibold">
                    {fiat.code}
                  </span>
                </div>
                <span className="text-[11px] text-gray-400 mt-1 block">
                  Maximum limit per individual trade order.
                </span>
              </div>
            </div>

            {/* Sell Ad Balance Requirement Check */}
            {adType === 'sell' && (
              <div className="pt-2">
                {(() => {
                  const avail = balances[crypto as CryptoCurrency]?.available || 0;
                  const reqCoin = (parseFloat(minAmount || '0') || 0) / (calculatedOfferPrice || 1);
                  const isShort = avail < reqCoin;

                  return (
                    <div className={`p-3 rounded-lg border text-xs flex items-start gap-2.5 transition ${
                      isShort
                        ? 'bg-rose-50 dark:bg-rose-950/30 border-rose-200 dark:border-rose-900/60 text-rose-700 dark:text-rose-300'
                        : 'bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900/60 text-emerald-700 dark:text-emerald-300'
                    }`}>
                      <div className="mt-0.5 font-bold">
                        {isShort ? '⚠️' : '✓'}
                      </div>
                      <div className="flex-1 space-y-0.5">
                        <div className="font-semibold">
                          {isShort ? 'Insufficient balance for minimum limit' : 'Wallet balance verified'}
                        </div>
                        <div className="text-[11px] opacity-90 leading-relaxed">
                          Your available balance: <span className="font-mono font-bold">{avail.toFixed(6)} {crypto}</span>. 
                          Minimum required for {minAmount || '0'} {fiat.code}: <span className="font-mono font-bold">{reqCoin.toFixed(6)} {crypto}</span>.
                          {isShort && ' Please deposit funds or lower your minimum trade limit before publishing.'}
                        </div>
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Payment Window
              </label>
              <div className="relative">
                <select
                  value={paymentWindow}
                  onChange={(e) => setPaymentWindow(e.target.value)}
                  className="w-full appearance-none px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-[#202026] text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#9273fc] pr-8"
                >
                  <option value="30">30 minutes</option>
                  <option value="60">60 minutes</option>
                  <option value="90">90 minutes</option>
                  <option value="120">120 minutes</option>
                </select>
                <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-3.5 pointer-events-none" />
              </div>
              <span className="text-[11px] text-gray-400 mt-1 block">
                Time buyer has to pay.
              </span>
            </div>
          </div>

          {/* STEP 4: Targeted & Blocked Countries */}
          <div className="bg-white dark:bg-[#18181c] p-5 md:p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-5 transition-colors">
            <div>
              <label className="block text-sm font-medium text-gray-900 dark:text-white">
                Targeted Countries (Optional)
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Only show this ad to users from these countries.
              </p>
              <button
                type="button"
                onClick={() => {
                  setCountrySearch('');
                  setIsTargetedModalOpen(true);
                }}
                className="mt-3 w-full py-2.5 px-4 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-[#202026] hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                  <span>
                    {targetedCountries.length > 0
                      ? `${targetedCountries.length} Countries Selected`
                      : 'Select Targeted Countries'}
                  </span>
                </div>
                {targetedCountries.length > 0 && (
                  <span className="bg-[#9273fc] text-white px-2 py-0.5 rounded-full text-[10px] font-semibold">
                    {targetedCountries.length}
                  </span>
                )}
              </button>
            </div>

            <div className="pt-2 border-t border-gray-100 dark:border-gray-800">
              <label className="block text-sm font-medium text-gray-900 dark:text-white">
                Blocked Countries (Optional)
              </label>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Hide this ad from users in these countries.
              </p>
              <button
                type="button"
                onClick={() => {
                  setCountrySearch('');
                  setIsBlockedModalOpen(true);
                }}
                className="mt-3 w-full py-2.5 px-4 border border-gray-200 dark:border-gray-700 rounded-lg text-xs font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-[#202026] hover:bg-gray-50 dark:hover:bg-gray-800 flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <Globe className="w-3.5 h-3.5 text-gray-500 dark:text-gray-400" />
                  <span>
                    {blockedCountries.length > 0
                      ? `${blockedCountries.length} Countries Blocked`
                      : 'Select Blocked Countries'}
                  </span>
                </div>
                {blockedCountries.length > 0 && (
                  <span className="bg-rose-500 text-white px-2 py-0.5 rounded-full text-[10px] font-semibold">
                    {blockedCountries.length}
                  </span>
                )}
              </button>
            </div>
          </div>

          {/* STEP 5: Terms, Labels, Tags & Requirements */}
          <div className="bg-white dark:bg-[#18181c] p-5 md:p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-5 transition-colors">
            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Terms & Conditions
              </label>
              <textarea
                rows={3}
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                placeholder="e.g., Fast release upon payment receipt. Please leave reference note..."
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] text-gray-900 dark:text-white rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#9273fc] resize-none"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Offer Label (Optional)
              </label>
              <input
                type="text"
                maxLength={30}
                value={offerLabel}
                onChange={(e) => setOfferLabel(e.target.value)}
                placeholder="e.g., Best rate on the market!"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] text-gray-900 dark:text-white rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#9273fc]"
              />
              <span className="text-[11px] text-gray-400 mt-1 block">
                A short, eye-catching label for your ad (max 30 characters).
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-1">
                Ad Tags
              </label>
              <p className="text-[11px] text-gray-400 mb-2">Select tags that apply to your ad.</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  'Instant release',
                  'No receipt required',
                  'No verification',
                  'Invoice accepted',
                ].map((tag) => {
                  const isChecked = selectedTags.includes(tag);
                  return (
                    <label
                      key={tag}
                      onClick={() => toggleTag(tag)}
                      className={`flex items-center gap-2 p-2 border rounded-lg cursor-pointer transition text-xs ${
                        isChecked
                          ? 'border-[#9273fc] bg-purple-50/50 dark:bg-[#9273fc]/20 text-[#9273fc] dark:text-purple-300 font-medium'
                          : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isChecked}
                        readOnly
                        className="rounded border-gray-300 text-[#9273fc] focus:ring-[#9273fc]"
                      />
                      <span>{tag}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="pt-2 border-t border-gray-100 dark:border-gray-800 space-y-4">
              <h3 className="text-sm font-medium text-gray-900 dark:text-white">Trader Requirements</h3>

              {/* Requirement Checkboxes */}
              <div className="space-y-2.5">
                <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] hover:bg-gray-50 dark:hover:bg-gray-800/80 cursor-pointer transition">
                  <input
                    type="checkbox"
                    id="checkbox-full-name-verified"
                    checked={requireFullNameVerified}
                    onChange={(e) => setRequireFullNameVerified(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-[#9273fc] focus:ring-[#9273fc] cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-semibold text-gray-900 dark:text-white block">
                      Only full name verified take trade
                    </span>
                    <span className="text-[11px] text-gray-500 dark:text-gray-400 block mt-0.5">
                      Counterparty must have completed full legal name identity verification before opening this trade.
                    </span>
                  </div>
                </label>

                <label className="flex items-start gap-3 p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] hover:bg-gray-50 dark:hover:bg-gray-800/80 cursor-pointer transition">
                  <input
                    type="checkbox"
                    id="checkbox-verified-users-only"
                    checked={requireVerifiedUsers}
                    onChange={(e) => setRequireVerifiedUsers(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-gray-300 dark:border-gray-600 text-[#9273fc] focus:ring-[#9273fc] cursor-pointer"
                  />
                  <div>
                    <span className="text-xs font-semibold text-gray-900 dark:text-white block">
                      Verified users take trade
                    </span>
                    <span className="text-[11px] text-gray-500 dark:text-gray-400 block mt-0.5">
                      Only allow verified accounts with confirmed KYC status to take this trade.
                    </span>
                  </div>
                </label>
              </div>

              <div>
                <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                  Minimum Completed Trades
                </label>
                <div className="relative">
                  <select
                    value={minTrades}
                    onChange={(e) => setMinTrades(e.target.value)}
                    className="w-full appearance-none px-3 py-2.5 border border-gray-200 dark:border-gray-700 rounded-lg text-xs bg-white dark:bg-[#202026] text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-[#9273fc] pr-8 cursor-pointer"
                  >
                    <option value="0">No requirement</option>
                    <option value="1">1 completed trade</option>
                    <option value="2">2 completed trades</option>
                    <option value="3">3 completed trades</option>
                    <option value="4">4 completed trades</option>
                    <option value="5">5 completed trades</option>
                  </select>
                  <ChevronDown className="w-4 h-4 text-gray-400 absolute right-3 top-3 pointer-events-none" />
                </div>
                <span className="text-[11px] text-gray-400 mt-1 block">
                  Set a minimum number of trades a user must have completed to start a trade with you.
                </span>
              </div>
            </div>
          </div>

          {/* Create Ad Submit Button with #9273fc Theme */}
          <button
            type="submit"
            onClick={() => handleSubmit()}
            disabled={isSubmitting}
            className="w-full py-3.5 bg-[#9273fc] text-white rounded-xl font-medium text-sm hover:bg-[#8160f5] transition shadow-md shadow-[#9273fc]/25 disabled:opacity-50 cursor-pointer active:scale-[0.99]"
          >
            {isSubmitting ? 'Creating Ad...' : 'Create Ad'}
          </button>
        </form>

      </div>

      {/* --- MODAL: Change Fiat --- */}
      {isFiatModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#18181c] rounded-xl max-w-md w-full max-h-[80vh] flex flex-col shadow-2xl border border-gray-200 dark:border-gray-800">
            <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Change Fiat Currency</h3>
              <button type="button" onClick={() => setIsFiatModalOpen(false)}>
                <X className="w-4 h-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" />
              </button>
            </div>
            <div className="p-3 border-b border-gray-100 dark:border-gray-800">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search currency name or code..."
                  value={fiatSearch}
                  onChange={(e) => setFiatSearch(e.target.value)}
                  className="w-full pl-9 pr-8 py-1.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] text-gray-900 dark:text-white rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#9273fc]"
                />
                {fiatSearch && (
                  <button type="button" onClick={() => setFiatSearch('')} className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="overflow-y-auto p-2 divide-y divide-gray-50 dark:divide-gray-800/40">
              {filteredFiats.map((item) => (
                <button
                  key={item.code}
                  type="button"
                  onClick={() => {
                    setFiat(item);
                    setIsFiatModalOpen(false);
                  }}
                  className="w-full flex items-center justify-between p-2.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-800/60 rounded-lg transition"
                >
                  <div className="flex items-center gap-3">
                    <img 
                      src={`https://flagcdn.com/w40/${item.flag}.png`} 
                      alt={item.code} 
                      className="w-5 h-3.5 object-cover rounded-[2px]" 
                    />
                    <div>
                      <div className="font-medium text-gray-800 dark:text-gray-200">{item.name}</div>
                      <div className="text-[11px] text-gray-400">{item.code}</div>
                    </div>
                  </div>
                  {fiat.code === item.code && <Check className="w-4 h-4 text-[#9273fc]" />}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* --- MODAL: Targeted / Blocked Countries --- */}
      {(isTargetedModalOpen || isBlockedModalOpen) && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#18181c] rounded-xl max-w-md w-full max-h-[80vh] flex flex-col shadow-2xl border border-gray-200 dark:border-gray-800">
            <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h3 className="font-semibold text-gray-900 dark:text-white text-sm">
                {isTargetedModalOpen ? 'Select Targeted Countries' : 'Select Blocked Countries'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsTargetedModalOpen(false);
                  setIsBlockedModalOpen(false);
                }}
              >
                <X className="w-4 h-4 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200" />
              </button>
            </div>
            <div className="p-3 border-b border-gray-100 dark:border-gray-800 flex gap-2">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search countries..."
                  value={countrySearch}
                  onChange={(e) => setCountrySearch(e.target.value)}
                  className="w-full pl-9 pr-8 py-1.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] text-gray-900 dark:text-white rounded-lg text-xs focus:outline-none focus:ring-1 focus:ring-[#9273fc]"
                />
                {countrySearch && (
                  <button type="button" onClick={() => setCountrySearch('')} className="absolute right-2.5 top-2 text-gray-400 hover:text-gray-600">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isTargetedModalOpen) setTargetedCountries([]);
                  else setBlockedCountries([]);
                }}
                className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-[11px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
              >
                Clear All
              </button>
            </div>
            <div className="overflow-y-auto p-2 divide-y divide-gray-50 dark:divide-gray-800/40 max-h-[50vh]">
              {ALL_COUNTRIES.filter((c) =>
                c.name.toLowerCase().includes(countrySearch.toLowerCase())
              ).map((country) => {
                const list = isTargetedModalOpen ? targetedCountries : blockedCountries;
                const isSelected = list.includes(country.name);

                const handleToggle = () => {
                  if (isTargetedModalOpen) {
                    setTargetedCountries(
                      isSelected
                        ? targetedCountries.filter((c) => c !== country.name)
                        : [...targetedCountries, country.name]
                    );
                  } else {
                    setBlockedCountries(
                      isSelected
                        ? blockedCountries.filter((c) => c !== country.name)
                        : [...blockedCountries, country.name]
                    );
                  }
                };

                return (
                  <button
                    key={country.name}
                    type="button"
                    onClick={handleToggle}
                    className="w-full flex items-center justify-between p-2.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-800/60 rounded-lg transition"
                  >
                    <div className="flex items-center gap-3">
                      <img 
                        src={`https://flagcdn.com/w40/${country.code}.png`} 
                        alt={country.name} 
                        className="w-5 h-3.5 object-cover rounded-[2px]" 
                      />
                      <span className="text-gray-800 dark:text-gray-200">{country.name}</span>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-[#9273fc]" />}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}