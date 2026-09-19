'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
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
  ChevronDown,
  Loader2,
  ArrowLeft
} from 'lucide-react';
import Link from 'next/link';

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
  { name: 'UAE Dirham', code: 'AED', flag: 'ae' },
  { name: 'Pakistani Rupee', code: 'PKR', flag: 'pk' },
  { name: 'Bangladeshi Taka', code: 'BDT', flag: 'bd' },
  { name: 'Nigerian Naira', code: 'NGN', flag: 'ng' },
  { name: 'Philippine Peso', code: 'PHP', flag: 'ph' },
  { name: 'Indonesian Rupiah', code: 'IDR', flag: 'id' },
  { name: 'Vietnamese Dong', code: 'VND', flag: 'vn' },
  { name: 'Thai Baht', code: 'THB', flag: 'th' },
  { name: 'Malaysian Ringgit', code: 'MYR', flag: 'my' },
  { name: 'Polish Zloty', code: 'PLN', flag: 'pl' },
  { name: 'Colombian Peso', code: 'COP', flag: 'co' },
  { name: 'Argentine Peso', code: 'ARS', flag: 'ar' },
  { name: 'Chilean Peso', code: 'CLP', flag: 'cl' },
  { name: 'Peruvian Sol', code: 'PEN', flag: 'pe' },
  { name: 'Kenyan Shilling', code: 'KES', flag: 'ke' },
  { name: 'Ghanaian Cedi', code: 'GHS', flag: 'gh' },
  { name: 'Egyptian Pound', code: 'EGP', flag: 'eg' },
  { name: 'Ukrainian Hryvnia', code: 'UAH', flag: 'ua' }
];

const PAYMENT_CATEGORIES = [
  {
    id: 'bank',
    title: 'Bank Transfers',
    subtitle: 'National and international bank transfers',
    icon: Building2,
    options: [
      'Bank Transfer',
      'IMPS',
      'NEFT / RTGS',
      'SEPA (EU) bank transfer',
      'SEPA Instant',
      'Wire Transfer',
      'Faster Payments (UK)',
      'Interac e-Transfer (Canada)',
      'ACH Transfer (USA)',
      'Direct Deposit'
    ]
  },
  {
    id: 'online',
    title: 'Online Wallets',
    subtitle: 'Digital wallets and payment apps',
    icon: Wallet,
    options: [
      'UPI',
      'PayTM',
      'PhonePe',
      'Google Pay (GPay)',
      'PayPal',
      'Wise (TransferWise)',
      'Revolut',
      'Skrill',
      'Neteller',
      'Venmo',
      'Zelle',
      'Cash App',
      'AdvCash',
      'Perfect Money',
      'Payeer',
      'WebMoney',
      'Airtel Money'
    ]
  },
  {
    id: 'mobile',
    title: 'Mobile Payments',
    subtitle: 'Carrier billing and mobile money',
    icon: Smartphone,
    options: [
      'M-Pesa',
      'MTN Mobile Money',
      'Orange Money',
      'Vodafone Cash',
      'EcoCash',
      'Easypaisa',
      'JazzCash',
      'bKash',
      'Nagad',
      'Rocket',
      'GrabPay',
      'GCash',
      'PayMaya',
      'TrueMoney'
    ]
  },
  {
    id: 'cash',
    title: 'Cash Payments',
    subtitle: 'Physical cash deposits and hand-to-hand',
    icon: Banknote,
    options: [
      'Cash in Person',
      'Cash Deposit to Bank',
      'Western Union',
      'MoneyGram',
      'Ria Money Transfer',
      'Postal Order'
    ]
  },
  {
    id: 'giftcard',
    title: 'Gift Cards',
    subtitle: 'Retail and digital gift vouchers',
    icon: Gift,
    options: [
      'Amazon Gift Card',
      'Apple / iTunes Gift Card',
      'Google Play Gift Card',
      'Steam Wallet Gift Card',
      'eBay Gift Card',
      'PlayStation Network Card',
      'Xbox Live Gift Card',
      'Razer Gold',
      'Vanilla / Visa / Mastercard Prepaid',
      'Walmart Gift Card',
      'Target Gift Card',
      'Netflix Gift Card'
    ]
  }
];

export default function EditAdPage() {
  const router = useRouter();
  const params = useParams();
  const adId = params?.adId as string;

  const { balances } = useWallet();
  const [user, setUser] = useState<any>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoadingAd, setIsLoadingAd] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Modals
  const [isFiatModalOpen, setIsFiatModalOpen] = useState(false);
  const [fiatSearch, setFiatSearch] = useState('');
  const [isTargetedModalOpen, setIsTargetedModalOpen] = useState(false);
  const [isBlockedModalOpen, setIsBlockedModalOpen] = useState(false);
  const [countrySearch, setCountrySearch] = useState('');

  // Form State
  const [adType, setAdType] = useState<'buy' | 'sell'>('buy');
  const [crypto, setCrypto] = useState('USDT');
  const [fiat, setFiat] = useState({ name: 'United States Dollar', code: 'USD', flag: 'us' });
  
  // Payment state & search
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

  // Terms, Tags, Countries & Requirements
  const [terms, setTerms] = useState('');
  const [offerLabel, setOfferLabel] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [targetedCountries, setTargetedCountries] = useState<string[]>([]);
  const [blockedCountries, setBlockedCountries] = useState<string[]>([]);
  const [minTrades, setMinTrades] = useState('0');
  const [requireFullNameVerified, setRequireFullNameVerified] = useState(false);
  const [requireVerifiedUsers, setRequireVerifiedUsers] = useState(false);

  // Pricing Context
  const { prices, fiatRates } = usePrices();

  // Dynamic minimum limit calculation
  const dynamicMinLimit = useMemo(() => {
    return calculateMinimumFiatAmount(10.00, fiat.code, fiatRates);
  }, [fiat.code, fiatRates]);

  // Check Auth State
  useEffect(() => {
    let isMounted = true;
    const checkUser = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (isMounted) {
          setUser(session?.user ?? null);
        }
      } catch (err) {
        console.error('Session check error:', err);
      } finally {
        if (isMounted) {
          setAuthLoading(false);
        }
      }
    };
    checkUser();

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

  // Compute base market price
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

  // Fetch Market Price
  useEffect(() => {
    let isCancelled = false;
    const fetchMarketPrice = async () => {
      try {
        let fetchedPrice: number | null = null;
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

        if (!isCancelled) {
          const resolved = getBaseMarketPrice(crypto, fiat.code, fetchedPrice);
          setCurrentMarketPrice(resolved);
        }
      } catch (err) {
        if (!isCancelled) {
          setCurrentMarketPrice(getBaseMarketPrice(crypto, fiat.code));
        }
      }
    };

    fetchMarketPrice();
    const interval = setInterval(fetchMarketPrice, 30000);
    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [crypto, fiat.code, getBaseMarketPrice]);

  // Load Existing Ad Data
  useEffect(() => {
    if (!adId) return;

    let isMounted = true;
    const loadAd = async () => {
      setIsLoadingAd(true);
      setLoadError(null);
      try {
        const res = await fetch(`/api/ads/${adId}`);
        if (!res.ok) {
          throw new Error(`Failed to load advertisement (status ${res.status})`);
        }
        const data = await res.json();
        const ad = data.ad || data;

        if (!ad) {
          throw new Error('Advertisement data not found');
        }

        if (isMounted) {
          const loadedSide = String(ad.type || ad.adType || ad.side || 'BUY').toUpperCase();
          setAdType(loadedSide.includes('SELL') ? 'sell' : 'buy');

          const loadedCoin = (ad.asset || ad.crypto || ad.coin || 'USDT').toUpperCase();
          setCrypto(loadedCoin);

          const loadedFiatCode = (ad.fiat_currency || ad.fiatCurrency || ad.fiat || 'USD').toUpperCase();
          const matchedFiat = FIAT_CURRENCIES.find((f) => f.code === loadedFiatCode) || {
            name: `${loadedFiatCode} Currency`,
            code: loadedFiatCode,
            flag: 'us',
          };
          setFiat(matchedFiat);

          const isFixed = ad.rate_type === 'fixed' || ad.pricing_type === 'FIXED' || Boolean(ad.is_fixed);
          setRateType(isFixed ? 'fixed' : 'market');
          
          if (ad.rate_percent !== undefined) setRatePercent(String(ad.rate_percent));
          else if (ad.margin !== undefined) setRatePercent(String(ad.margin));
          
          if (ad.price) setFixedPrice(String(ad.price));
          else if (ad.unit_price) setFixedPrice(String(ad.unit_price));

          const minVal = ad.min_amount ?? ad.min_limit ?? ad.minAmount ?? 10;
          const maxVal = ad.max_amount ?? ad.max_limit ?? ad.maxAmount ?? 1000;
          setMinAmount(String(minVal));
          setMaxAmount(String(maxVal));

          const winVal = Math.max(30, Number(ad.payment_window ?? ad.payment_window_minutes ?? 30));
          setPaymentWindow(String(winVal));

          const rawMethods = ad.payment_methods || ad.paymentMethods || [];
          const parsedMethods = Array.isArray(rawMethods)
            ? rawMethods
            : typeof rawMethods === 'string'
            ? JSON.parse(rawMethods)
            : ['Bank Transfer'];
          setSelectedPaymentMethods(parsedMethods);

          setTerms(ad.terms || ad.terms_conditions || '');
          setOfferLabel(ad.offer_label || ad.offerLabel || '');

          const rawTags = ad.tags || ad.ad_tags || ad.offer_tags || [];
          setSelectedTags(Array.isArray(rawTags) ? rawTags : []);

          setTargetedCountries(Array.isArray(ad.targeted_countries) ? ad.targeted_countries : []);
          setBlockedCountries(Array.isArray(ad.blocked_countries) ? ad.blocked_countries : []);
          setMinTrades(String(ad.min_completed_trades || 0));
          setRequireFullNameVerified(Boolean(ad.require_full_name_verified));
          setRequireVerifiedUsers(Boolean(ad.require_verified_users));
        }
      } catch (err: any) {
        if (isMounted) {
          console.error('Error fetching ad to edit:', err);
          setLoadError(err.message || 'Could not load advertisement details.');
        }
      } finally {
        if (isMounted) {
          setIsLoadingAd(false);
        }
      }
    };

    loadAd();
    return () => {
      isMounted = false;
    };
  }, [adId]);

  // Payment method toggles & custom methods
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
    const trimmed = customMethod.trim();
    if (!trimmed) return;
    if (selectedPaymentMethods.includes(trimmed)) {
      toast.info('This payment method is already selected.');
      return;
    }
    if (selectedPaymentMethods.length >= 5) {
      toast.error('You can select a maximum of 5 payment methods.');
      return;
    }
    setSelectedPaymentMethods([...selectedPaymentMethods, trimmed]);
    setCustomMethod('');
    toast.success(`Added "${trimmed}" to payment methods`);
  };

  const allAvailablePaymentMethods = useMemo(() => {
    const list: { name: string; category: string }[] = [];
    PAYMENT_CATEGORIES.forEach((cat) => {
      cat.options.forEach((opt) => {
        list.push({ name: opt, category: cat.title });
      });
    });
    return list;
  }, []);

  const searchedPaymentMethods = useMemo(() => {
    if (!paymentSearch.trim()) return [];
    const q = paymentSearch.toLowerCase().trim();
    return allAvailablePaymentMethods.filter((item) =>
      item.name.toLowerCase().includes(q) || item.category.toLowerCase().includes(q)
    );
  }, [paymentSearch, allAvailablePaymentMethods]);

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      setSelectedTags(selectedTags.filter((t) => t !== tag));
    } else {
      setSelectedTags([...selectedTags, tag]);
    }
  };

  const handleSelectRateType = (type: 'market' | 'fixed') => {
    setRateType(type);
    if (type === 'fixed') {
      const base = currentMarketPrice || 1.0;
      const margin = parseFloat(ratePercent) || 0;
      const computed = base * (1 + margin / 100);
      setFixedPrice(computed.toFixed(crypto === 'USDT' ? 2 : 4));
    }
  };

  // Submit Handler: Saves changes via PUT /api/ads/[adId]
  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();

    if (selectedPaymentMethods.length === 0) {
      toast.error('Please select at least one payment method.');
      return;
    }

    const min = parseFloat(minAmount);
    const max = parseFloat(maxAmount);

    if (isNaN(min) || isNaN(max) || min <= 0 || max <= 0) {
      toast.error('Please specify valid minimum and maximum trade amounts.');
      return;
    }

    if (min < dynamicMinLimit) {
      toast.error(`Minimum trade limit must be at least ${dynamicMinLimit.toLocaleString()} ${fiat.code} ($10.00 USD).`);
      return;
    }

    if (min > max) {
      toast.error('Minimum amount cannot exceed maximum amount.');
      return;
    }

    setIsSubmitting(true);
    const toastId = toast.loading('Saving advertisement changes...');

    try {
      const marginPercentage = parseFloat(ratePercent) || 0;
      const pricingType = rateType === 'market' ? 'FLOAT' : 'FIXED';
      const calculatedPrice = rateType === 'market'
        ? (currentMarketPrice || 1.0) * (1 + marginPercentage / 100)
        : Number(fixedPrice);

      const updatePayload = {
        pricing_type: pricingType,
        rate_type: rateType,
        is_fixed: rateType === 'fixed',
        price: calculatedPrice,
        unit_price: calculatedPrice,
        margin: marginPercentage,
        rate_percent: marginPercentage,
        min_amount: min,
        max_amount: max,
        min_limit: min,
        max_limit: max,
        payment_window: Math.max(30, parseInt(paymentWindow, 10) || 30),
        payment_methods: selectedPaymentMethods,
        targeted_countries: targetedCountries,
        blocked_countries: blockedCountries,
        terms: terms,
        offer_label: offerLabel,
        tags: selectedTags,
        min_completed_trades: parseInt(minTrades, 10) || 0,
        require_full_name_verified: requireFullNameVerified,
        require_verified_users: requireVerifiedUsers,
      };

      const res = await fetch(`/api/ads/${adId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatePayload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to update advertisement.');
      }

      toast.success('Advertisement updated successfully!', { id: toastId });
      setTimeout(() => {
        router.push('/my-ads');
      }, 500);
    } catch (err: any) {
      console.error('Update error:', err);
      toast.error(`Update failed: ${err.message || String(err)}`, { id: toastId });
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

  if (isLoadingAd) {
    return (
      <div className="min-h-screen bg-[#fafafa] dark:bg-[#0f0f12] flex flex-col items-center justify-center p-6">
        <Loader2 className="w-8 h-8 text-[#9273fc] animate-spin mb-3" />
        <p className="text-sm text-gray-500 dark:text-gray-400">Loading advertisement settings...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="min-h-screen bg-[#fafafa] dark:bg-[#0f0f12] flex flex-col items-center justify-center p-6 text-center">
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400 rounded-xl max-w-md mb-4">
          <p className="font-semibold text-sm mb-1">Failed to load advertisement</p>
          <p className="text-xs">{loadError}</p>
        </div>
        <Link
          href="/my-ads"
          className="inline-flex items-center gap-2 px-4 py-2 bg-[#9273fc] text-white text-xs font-medium rounded-lg hover:bg-[#8160f5] transition"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to My Ads
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#fafafa] dark:bg-[#0f0f12] text-gray-900 dark:text-gray-100 px-4 py-8 md:py-12 flex justify-center transition-colors">
      <div className="w-full max-w-3xl space-y-8">
        
        {/* Solid #9273fc Header banner matching /ads/create */}
        <div className="bg-[#9273fc] text-white py-8 px-6 sm:px-8 rounded-2xl shadow-lg">
          <div className="flex items-center justify-between mb-2">
            <Link
              href="/my-ads"
              className="inline-flex items-center gap-1.5 text-xs text-white/80 hover:text-white transition"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Back to My Ads
            </Link>
            <span className="text-[11px] font-mono bg-white/20 px-2.5 py-0.5 rounded-full">
              Ad #{adId?.slice(0, 8)}
            </span>
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight">
            Edit P2P Advertisement
          </h1>
          <p className="text-sm text-white/95 mt-1 font-medium">
            Update your offer limits, pricing method, payment options, and requirements
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

          {/* STEP 2: Payment Methods with Search */}
          <div className="bg-white dark:bg-[#18181c] p-5 md:p-6 rounded-xl border border-gray-200 dark:border-gray-800 shadow-sm space-y-5 transition-colors">
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Payment Methods</h2>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                Select up to 5 methods. Add a custom method if yours isn&apos;t listed.
              </p>
            </div>

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

          {/* STEP 3: Pricing & Limits */}
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
                  Set your adjustment percentage (from -50% to 50%).
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-medium text-gray-700 dark:text-gray-300">Fixed Price</label>
                  <span className="text-[11px] text-gray-500 dark:text-gray-400">
                    Market base: <strong className="text-gray-700 dark:text-gray-300">{fiat.code} {currentMarketPrice ? currentMarketPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '100.00'}</strong>
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

            {/* Payment Window - Minimum 30 mins */}
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

          {/* Update Ad Submit Button with #9273fc Theme */}
          <div className="flex items-center gap-3">
            <Link
              href="/my-ads"
              className="px-6 py-3.5 border border-gray-200 dark:border-gray-700 rounded-xl font-medium text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition text-center"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 py-3.5 bg-[#9273fc] text-white rounded-xl font-medium text-sm hover:bg-[#8160f5] transition shadow-md shadow-[#9273fc]/25 disabled:opacity-50 cursor-pointer active:scale-[0.99] text-center"
            >
              {isSubmitting ? 'Saving Changes...' : 'Save Changes'}
            </button>
          </div>
        </form>

      </div>

      {/* MODAL: Change Fiat */}
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

      {/* MODAL: Targeted / Blocked Countries */}
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
