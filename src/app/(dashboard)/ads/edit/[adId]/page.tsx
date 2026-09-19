'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { supabase } from '@/lib/supabaseClient';
import { useWallet } from '@/context/wallet-context';
import { usePrices } from '@/context/price-context';
import { calculateMinimumFiatAmount } from '@/lib/currency';
import { CryptoCurrency } from '@/lib/types';
import { toast } from 'sonner';
import Link from 'next/link';
import { 
  Check, 
  Search, 
  X, 
  Building2, 
  Wallet, 
  Smartphone, 
  Banknote, 
  Gift, 
  Plus,
  Loader2,
  ArrowLeft,
  Sliders,
  DollarSign,
  ShieldCheck,
  Globe,
  Clock,
  Tag
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
      'Ria Money Transfer', 'Cash by mail', 'Postal order', 'Bank draft', "Cashier's check"
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

const AVAILABLE_TAGS = [
  'No KYC',
  'Instant Release',
  'Verified ID Only',
  'Fast Payment',
  'Online Now',
  'Trusted Trader',
  'Direct Bank',
  'Friendly Support',
  'No Third Party',
  'Instant Notification',
];

export default function EditP2PAdPage() {
  const router = useRouter();
  const params = useParams();
  const adId = Array.isArray(params.adId) ? params.adId[0] : params.adId;

  const { balances } = useWallet();
  const { prices, fiatRates } = usePrices();

  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [adType, setAdType] = useState<'buy' | 'sell'>('sell');
  const [crypto, setCrypto] = useState<string>('USDT');
  const [fiat, setFiat] = useState(FIAT_CURRENCIES[0]);
  const [rateType, setRateType] = useState<'market' | 'fixed'>('market');
  const [ratePercent, setRatePercent] = useState<string>('0');
  const [fixedPrice, setFixedPrice] = useState<string>('');
  const [minAmount, setMinAmount] = useState<string>('100');
  const [maxAmount, setMaxAmount] = useState<string>('5000');
  const [paymentTimeLimit, setPaymentTimeLimit] = useState<number>(30);
  const [selectedPaymentMethods, setSelectedPaymentMethods] = useState<string[]>(['Bank Transfer']);
  const [customMethod, setCustomMethod] = useState('');
  const [paymentSearch, setPaymentSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('all');

  const [targetedCountries, setTargetedCountries] = useState<string[]>([]);
  const [blockedCountries, setBlockedCountries] = useState<string[]>([]);
  const [terms, setTerms] = useState('');
  const [offerLabel, setOfferLabel] = useState('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [minTrades, setMinTrades] = useState('0');
  const [isActive, setIsActive] = useState(true);

  // Modals
  const [isFiatModalOpen, setIsFiatModalOpen] = useState(false);
  const [isTargetedModalOpen, setIsTargetedModalOpen] = useState(false);
  const [isBlockedModalOpen, setIsBlockedModalOpen] = useState(false);
  const [fiatSearch, setFiatSearch] = useState('');
  const [countrySearch, setCountrySearch] = useState('');

  // Load existing ad data
  useEffect(() => {
    async function loadAdData() {
      if (!adId) return;
      setIsLoading(true);
      try {
        let rawData: any = null;
        const { data: p2pData } = await supabase
          .from('p2p_ads')
          .select('*')
          .or(`id.eq.${adId},public_ad_id.eq.${adId}`)
          .maybeSingle();

        if (p2pData) {
          rawData = p2pData;
        } else {
          const { data: adsData } = await supabase
            .from('ads')
            .select('*')
            .or(`id.eq.${adId},public_ad_id.eq.${adId}`)
            .maybeSingle();
          if (adsData) rawData = adsData;
        }

        if (rawData) {
          const side = (rawData.type || rawData.ad_type || rawData.adType || rawData.side || 'sell').toLowerCase();
          setAdType(side === 'buy' ? 'buy' : 'sell');

          const rawCrypto = (rawData.coin || rawData.crypto || rawData.asset || rawData.asset_symbol || 'USDT').toUpperCase();
          setCrypto(rawCrypto);

          const rawFiatCode = (rawData.fiat || rawData.fiat_currency || rawData.fiatCurrency || 'USD').toUpperCase();
          const foundFiat = FIAT_CURRENCIES.find((f) => f.code.toUpperCase() === rawFiatCode) || {
            name: `${rawFiatCode} Currency`,
            code: rawFiatCode,
            flag: rawFiatCode.slice(0, 2).toLowerCase(),
          };
          setFiat(foundFiat);

          const isFixed = rawData.pricing_type === 'FIXED' || rawData.rate_type === 'fixed' || Boolean(rawData.is_fixed);
          setRateType(isFixed ? 'fixed' : 'market');

          if (rawData.price !== undefined && rawData.price !== null) {
            setFixedPrice(String(rawData.price));
          } else if (rawData.fixed_rate !== undefined && rawData.fixed_rate !== null) {
            setFixedPrice(String(rawData.fixed_rate));
          }

          const margin = rawData.margin ?? rawData.margin_percent ?? rawData.rate_percent ?? rawData.ratePercent ?? 0;
          setRatePercent(String(margin));

          const minVal = rawData.min_amount ?? rawData.min_limit ?? rawData.minAmount ?? 100;
          const maxVal = rawData.max_amount ?? rawData.max_limit ?? rawData.maxAmount ?? 5000;
          setMinAmount(String(minVal));
          setMaxAmount(String(maxVal));

          const pTime = Number(rawData.payment_window ?? rawData.payment_time_limit ?? rawData.paymentTimeLimit ?? 30);
          setPaymentTimeLimit(pTime);

          let pMethods: string[] = ['Bank Transfer'];
          if (Array.isArray(rawData.payment_methods)) pMethods = rawData.payment_methods;
          else if (Array.isArray(rawData.paymentMethods)) pMethods = rawData.paymentMethods;
          else if (typeof rawData.payment_methods === 'string') {
            try {
              const parsed = JSON.parse(rawData.payment_methods);
              if (Array.isArray(parsed)) pMethods = parsed;
              else pMethods = [rawData.payment_methods];
            } catch {
              pMethods = [rawData.payment_methods];
            }
          }
          setSelectedPaymentMethods(pMethods.length > 0 ? pMethods : ['Bank Transfer']);

          setTerms(rawData.terms_conditions || rawData.terms || '');
          setOfferLabel(rawData.offer_label || rawData.label || rawData.offerLabel || '');
          if (Array.isArray(rawData.tags)) setSelectedTags(rawData.tags);
          if (Array.isArray(rawData.targeted_countries)) setTargetedCountries(rawData.targeted_countries);
          if (Array.isArray(rawData.blocked_countries)) setBlockedCountries(rawData.blocked_countries);
          setMinTrades(String(rawData.min_completed_trades ?? rawData.minTrades ?? 0));
          setIsActive(rawData.status ? rawData.status.toUpperCase() === 'ACTIVE' : (rawData.is_active ?? rawData.active ?? true));
        } else {
          toast.error('Ad not found');
        }
      } catch (err) {
        console.error('Failed to load ad for editing:', err);
        toast.error('Failed to load ad details');
      } finally {
        setIsLoading(false);
      }
    }
    loadAdData();
  }, [adId]);

  // Current market price computation
  const currentMarketPrice = useMemo(() => {
    const cryptoUsd = prices[crypto as CryptoCurrency] || (crypto === 'USDT' ? 1 : 0);
    const fiatRate = fiatRates[fiat.code] || 1;
    return cryptoUsd * fiatRate;
  }, [crypto, fiat.code, prices, fiatRates]);

  // Calculated effective price
  const effectivePrice = useMemo(() => {
    if (rateType === 'fixed') {
      return parseFloat(fixedPrice) || currentMarketPrice || 1;
    }
    const margin = parseFloat(ratePercent) || 0;
    return currentMarketPrice * (1 + margin / 100);
  }, [rateType, fixedPrice, ratePercent, currentMarketPrice]);

  // Available balance for the selected crypto
  const availableCoinBalance = balances[crypto as CryptoCurrency]?.available || 0;

  // Search filtered fiats
  const filteredFiats = useMemo(() => {
    if (!fiatSearch.trim()) return FIAT_CURRENCIES;
    const q = fiatSearch.toLowerCase().trim();
    return FIAT_CURRENCIES.filter((f) => f.name.toLowerCase().includes(q) || f.code.toLowerCase().includes(q));
  }, [fiatSearch]);

  // Payment method handlers
  const togglePaymentMethod = (method: string) => {
    if (selectedPaymentMethods.includes(method)) {
      if (selectedPaymentMethods.length === 1) {
        toast.error('You must keep at least 1 payment method.');
        return;
      }
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

  // Submit Handler
  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!selectedPaymentMethods || selectedPaymentMethods.length === 0) {
      toast.error('Please select at least 1 payment method.');
      return;
    }

    if (rateType === 'fixed' && (!fixedPrice || parseFloat(fixedPrice) <= 0)) {
      toast.error('Please enter a valid fixed price.');
      return;
    }

    const minNum = parseFloat(minAmount);
    const maxNum = parseFloat(maxAmount);

    if (isNaN(minNum) || minNum <= 0) {
      toast.error('Please enter a valid minimum limit.');
      return;
    }

    if (isNaN(maxNum) || maxNum < minNum) {
      toast.error('Maximum limit must be greater than or equal to minimum limit.');
      return;
    }

    // Rule 1: Balance check on min_limit when selling
    if (adType === 'sell') {
      const minCoinRequired = minNum / (effectivePrice || 1);
      if (availableCoinBalance < minCoinRequired) {
        toast.error(`Insufficient ${crypto} balance. You need at least ${minCoinRequired.toFixed(6)} ${crypto} to set a minimum limit of ${minNum} ${fiat.code}. Available: ${availableCoinBalance.toFixed(6)} ${crypto}.`);
        return;
      }
    }

    setIsSubmitting(true);
    const toastId = toast.loading('Saving changes...');

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const payload = {
        type: adType.toUpperCase(),
        coin: crypto,
        fiat: fiat.code,
        price: rateType === 'fixed' ? Number(fixedPrice) : effectivePrice,
        pricing_type: rateType === 'fixed' ? 'FIXED' : 'FLOAT',
        margin: parseFloat(ratePercent) || 0,
        min_amount: minNum,
        max_amount: maxNum,
        payment_methods: selectedPaymentMethods,
        payment_window: paymentTimeLimit,
        terms_conditions: terms,
        offer_label: offerLabel,
        tags: selectedTags,
        targeted_countries: targetedCountries,
        blocked_countries: blockedCountries,
        min_completed_trades: parseInt(minTrades, 10) || 0,
        status: isActive ? 'ACTIVE' : 'INACTIVE',
        active: isActive,
      };

      const res = await fetch(`/api/p2p/ads/${adId}`, {
        method: 'PATCH',
        headers,
        credentials: 'include',
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to update advertisement');
      }

      toast.success('Advertisement updated successfully!', { id: toastId });
      router.push('/my-ads');
    } catch (err: any) {
      console.error('Update error:', err);
      toast.error(err.message || 'Failed to update ad', { id: toastId });
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-[#9273fc]" />
        <p className="text-xs text-gray-500">Loading advertisement details...</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto pb-20 space-y-6">
      {/* Top Breadcrumb & Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/my-ads"
            className="p-2 rounded-xl bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition"
          >
            <ArrowLeft className="w-5 h-5" />
          </Link>
          <div>
            <h1 className="text-xl sm:text-2xl font-black text-gray-900 dark:text-white">
              Edit P2P Advertisement
            </h1>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              Ad #{adId?.slice(0, 12)} • Update pricing, limits, payment methods, and conditions
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => setIsActive(!isActive)}
          className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition cursor-pointer ${
            isActive
              ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/30'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-500 border-gray-300 dark:border-gray-700'
          }`}
        >
          {isActive ? '● Active Offer' : '○ Paused / Offline'}
        </button>
      </div>

      <form onSubmit={handleUpdate} className="space-y-6">
        {/* Section 1: Ad Type & Asset */}
        <div className="p-6 bg-white dark:bg-[#18181c] border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xs space-y-5">
          <div className="flex items-center gap-2 pb-3 border-b border-gray-100 dark:border-gray-800">
            <Sliders className="w-4 h-4 text-[#9273fc]" />
            <h2 className="font-bold text-sm text-gray-900 dark:text-white">1. Type & Currency</h2>
          </div>

          {/* Buy vs Sell Selection */}
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setAdType('sell')}
              className={`p-4 rounded-xl border text-center transition cursor-pointer ${
                adType === 'sell'
                  ? 'border-red-500 bg-red-500/5 dark:bg-red-500/10 text-red-600 dark:text-red-400 font-bold shadow-xs'
                  : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:border-gray-300'
              }`}
            >
              <div className="text-sm font-black">I Want to Sell</div>
              <div className="text-[11px] opacity-75 mt-0.5">Post an offer for buyers to purchase your crypto</div>
            </button>

            <button
              type="button"
              onClick={() => setAdType('buy')}
              className={`p-4 rounded-xl border text-center transition cursor-pointer ${
                adType === 'buy'
                  ? 'border-green-500 bg-green-500/5 dark:bg-green-500/10 text-green-600 dark:text-green-400 font-bold shadow-xs'
                  : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:border-gray-300'
              }`}
            >
              <div className="text-sm font-black">I Want to Buy</div>
              <div className="text-[11px] opacity-75 mt-0.5">Post an offer for sellers to sell crypto to you</div>
            </button>
          </div>

          {/* Crypto Asset Selector */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Cryptocurrency Asset
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {CRYPTO_OPTIONS.map((c) => (
                <button
                  key={c.code}
                  type="button"
                  onClick={() => setCrypto(c.code)}
                  className={`p-3 rounded-xl border flex items-center gap-2.5 transition cursor-pointer ${
                    crypto === c.code
                      ? 'border-[#9273fc] bg-[#9273fc]/10 text-gray-900 dark:text-white font-bold'
                      : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                  }`}
                >
                  <img src={c.logo} alt={c.code} className="w-6 h-6 rounded-full" />
                  <div className="text-left">
                    <div className="text-xs font-bold">{c.code}</div>
                    <div className="text-[10px] text-gray-400">{c.code === 'USDT' ? 'Tether' : c.name.split(' ')[0]}</div>
                  </div>
                </button>
              ))}
            </div>
            {adType === 'sell' && (
              <p className="text-[11px] text-gray-500 mt-2">
                Available Wallet Balance: <span className="font-bold text-[#9273fc]">{availableCoinBalance.toFixed(6)} {crypto}</span>
              </p>
            )}
          </div>

          {/* Fiat Currency Selector */}
          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Fiat Currency
            </label>
            <button
              type="button"
              onClick={() => setIsFiatModalOpen(true)}
              className="w-full p-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#202026] flex items-center justify-between hover:border-[#9273fc] transition text-left cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <img
                  src={`https://flagcdn.com/w40/${fiat.flag}.png`}
                  alt={fiat.code}
                  className="w-6 h-4 object-cover rounded-[2px]"
                />
                <div>
                  <div className="text-xs font-bold text-gray-900 dark:text-white">{fiat.name} ({fiat.code})</div>
                  <div className="text-[10px] text-gray-400">1 USD ≈ {fiatRates[fiat.code] || 1} {fiat.code}</div>
                </div>
              </div>
              <span className="text-xs font-semibold text-[#9273fc]">Change Fiat →</span>
            </button>
          </div>
        </div>

        {/* Section 2: Pricing Strategy */}
        <div className="p-6 bg-white dark:bg-[#18181c] border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xs space-y-5">
          <div className="flex items-center gap-2 pb-3 border-b border-gray-100 dark:border-gray-800">
            <DollarSign className="w-4 h-4 text-[#9273fc]" />
            <h2 className="font-bold text-sm text-gray-900 dark:text-white">2. Pricing Strategy</h2>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setRateType('market')}
              className={`p-3 rounded-xl border text-center transition cursor-pointer ${
                rateType === 'market'
                  ? 'border-[#9273fc] bg-[#9273fc]/10 text-gray-900 dark:text-white font-bold'
                  : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400'
              }`}
            >
              <div className="text-xs font-bold">Floating Market Price</div>
              <div className="text-[10px] text-gray-400 mt-0.5">Tracks live market rates with margin %</div>
            </button>
            <button
              type="button"
              onClick={() => {
                setRateType('fixed');
                if (!fixedPrice) setFixedPrice(effectivePrice.toFixed(2));
              }}
              className={`p-3 rounded-xl border text-center transition cursor-pointer ${
                rateType === 'fixed'
                  ? 'border-[#9273fc] bg-[#9273fc]/10 text-gray-900 dark:text-white font-bold'
                  : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400'
              }`}
            >
              <div className="text-xs font-bold">Fixed Unit Price</div>
              <div className="text-[10px] text-gray-400 mt-0.5">Locks a constant price per {crypto}</div>
            </button>
          </div>

          {rateType === 'market' ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                  Margin Percentage (%)
                </label>
                <span className="text-xs font-mono font-bold text-[#9273fc]">
                  {parseFloat(ratePercent) >= 0 ? `+${ratePercent}%` : `${ratePercent}%`}
                </span>
              </div>
              <input
                type="number"
                step="0.01"
                value={ratePercent}
                onChange={(e) => setRatePercent(e.target.value)}
                placeholder="0.00"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] text-gray-900 dark:text-white rounded-xl text-xs focus:ring-1 focus:ring-[#9273fc] focus:outline-hidden"
              />
              <p className="text-[11px] text-gray-500">
                Market Price: {currentMarketPrice.toFixed(2)} {fiat.code} • Your Rate:{' '}
                <span className="font-bold text-gray-900 dark:text-white">{effectivePrice.toFixed(2)} {fiat.code}</span>
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                Fixed Price per 1 {crypto} ({fiat.code})
              </label>
              <input
                type="number"
                step="0.01"
                value={fixedPrice}
                onChange={(e) => setFixedPrice(e.target.value)}
                placeholder="e.g. 95.50"
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] text-gray-900 dark:text-white rounded-xl text-xs focus:ring-1 focus:ring-[#9273fc] focus:outline-hidden"
              />
            </div>
          )}
        </div>

        {/* Section 3: Trade Limits & Rules */}
        <div className="p-6 bg-white dark:bg-[#18181c] border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xs space-y-5">
          <div className="flex items-center gap-2 pb-3 border-b border-gray-100 dark:border-gray-800">
            <ShieldCheck className="w-4 h-4 text-[#9273fc]" />
            <h2 className="font-bold text-sm text-gray-900 dark:text-white">3. Trade Limits & Window</h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                Minimum Trade Limit ({fiat.code})
              </label>
              <input
                type="number"
                value={minAmount}
                onChange={(e) => setMinAmount(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] text-gray-900 dark:text-white rounded-xl text-xs focus:ring-1 focus:ring-[#9273fc] focus:outline-hidden"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                ≈ {((parseFloat(minAmount) || 0) / (effectivePrice || 1)).toFixed(4)} {crypto}
              </p>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
                Maximum Trade Limit ({fiat.code})
              </label>
              <input
                type="number"
                value={maxAmount}
                onChange={(e) => setMaxAmount(e.target.value)}
                className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] text-gray-900 dark:text-white rounded-xl text-xs focus:ring-1 focus:ring-[#9273fc] focus:outline-hidden"
              />
              <p className="text-[11px] text-gray-400 mt-1">
                ≈ {((parseFloat(maxAmount) || 0) / (effectivePrice || 1)).toFixed(4)} {crypto}
              </p>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Payment Window (Time Limit)
            </label>
            <div className="grid grid-cols-4 gap-2">
              {[15, 30, 45, 60].map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setPaymentTimeLimit(mins)}
                  className={`py-2 rounded-xl text-xs font-bold border transition cursor-pointer ${
                    paymentTimeLimit === mins
                      ? 'border-[#9273fc] bg-[#9273fc]/10 text-[#9273fc]'
                      : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400'
                  }`}
                >
                  {mins} mins
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Section 4: Payment Methods */}
        <div className="p-6 bg-white dark:bg-[#18181c] border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xs space-y-5">
          <div className="flex items-center justify-between pb-3 border-b border-gray-100 dark:border-gray-800">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-[#9273fc]" />
              <h2 className="font-bold text-sm text-gray-900 dark:text-white">4. Payment Methods</h2>
            </div>
            <span className="text-xs text-gray-400">
              Selected: <span className="font-bold text-[#9273fc]">{selectedPaymentMethods.length}/5</span>
            </span>
          </div>

          {/* Active Payment Method Pills */}
          <div className="flex flex-wrap gap-2">
            {selectedPaymentMethods.map((m) => (
              <span
                key={m}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[#9273fc]/15 text-[#9273fc] text-xs font-semibold border border-[#9273fc]/30"
              >
                {m}
                <button
                  type="button"
                  onClick={() => togglePaymentMethod(m)}
                  className="hover:text-red-500 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </span>
            ))}
          </div>

          {/* Category Tabs */}
          <div className="flex flex-wrap gap-1.5 p-1 bg-gray-100 dark:bg-[#202026] rounded-xl text-xs">
            <button
              type="button"
              onClick={() => setSelectedCategory('all')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                selectedCategory === 'all'
                  ? 'bg-white dark:bg-[#18181c] text-gray-900 dark:text-white shadow-xs'
                  : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
              }`}
            >
              All Categories
            </button>
            {PAYMENT_CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setSelectedCategory(cat.id)}
                className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                  selectedCategory === cat.id
                    ? 'bg-white dark:bg-[#18181c] text-gray-900 dark:text-white shadow-xs'
                    : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                {cat.title}
              </button>
            ))}
          </div>

          {/* Payment Method Search & Options */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
            <input
              type="text"
              placeholder="Search payment methods..."
              value={paymentSearch}
              onChange={(e) => setPaymentSearch(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] text-gray-900 dark:text-white rounded-xl text-xs focus:ring-1 focus:ring-[#9273fc] focus:outline-hidden"
            />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto p-1">
            {PAYMENT_CATEGORIES.filter((c) => selectedCategory === 'all' || c.id === selectedCategory)
              .flatMap((c) => c.options)
              .filter((opt) => opt.toLowerCase().includes(paymentSearch.toLowerCase()))
              .map((opt) => {
                const isSelected = selectedPaymentMethods.includes(opt);
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => togglePaymentMethod(opt)}
                    className={`p-2 rounded-xl text-xs text-left border transition truncate flex items-center justify-between cursor-pointer ${
                      isSelected
                        ? 'border-[#9273fc] bg-[#9273fc]/10 text-gray-900 dark:text-white font-bold'
                        : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400 hover:border-gray-300'
                    }`}
                  >
                    <span className="truncate">{opt}</span>
                    {isSelected && <Check className="w-3.5 h-3.5 text-[#9273fc] shrink-0" />}
                  </button>
                );
              })}
          </div>

          {/* Custom Payment Method Input */}
          <div className="flex gap-2 pt-2 border-t border-gray-100 dark:border-gray-800">
            <input
              type="text"
              placeholder="Or add custom payment method..."
              value={customMethod}
              onChange={(e) => setCustomMethod(e.target.value)}
              className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] text-gray-900 dark:text-white rounded-xl text-xs focus:ring-1 focus:ring-[#9273fc] focus:outline-hidden"
            />
            <button
              type="button"
              onClick={addCustomPaymentMethod}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs font-semibold rounded-xl transition cursor-pointer"
            >
              Add
            </button>
          </div>
        </div>

        {/* Section 5: Terms & Conditions & Tags */}
        <div className="p-6 bg-white dark:bg-[#18181c] border border-gray-200 dark:border-gray-800 rounded-2xl shadow-xs space-y-5">
          <div className="flex items-center gap-2 pb-3 border-b border-gray-100 dark:border-gray-800">
            <Tag className="w-4 h-4 text-[#9273fc]" />
            <h2 className="font-bold text-sm text-gray-900 dark:text-white">5. Tags, Terms & Verification</h2>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2">
              Offer Tags
            </label>
            <div className="flex flex-wrap gap-2">
              {AVAILABLE_TAGS.map((t) => {
                const isSelected = selectedTags.includes(t);
                return (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTag(t)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition cursor-pointer ${
                      isSelected
                        ? 'border-[#9273fc] bg-[#9273fc]/15 text-[#9273fc] font-bold'
                        : 'border-gray-200 dark:border-gray-800 text-gray-600 dark:text-gray-400'
                    }`}
                  >
                    {t}
                  </button>
                );
              })}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
              Offer Short Label
            </label>
            <input
              type="text"
              placeholder="e.g. Instant Transfer | 24/7 Fast"
              value={offerLabel}
              onChange={(e) => setOfferLabel(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] text-gray-900 dark:text-white rounded-xl text-xs focus:ring-1 focus:ring-[#9273fc] focus:outline-hidden"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
              Trade Terms & Instructions
            </label>
            <textarea
              rows={4}
              placeholder="Specify conditions, account verification requirements, or instructions for the counterparty..."
              value={terms}
              onChange={(e) => setTerms(e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] text-gray-900 dark:text-white rounded-xl text-xs focus:ring-1 focus:ring-[#9273fc] focus:outline-hidden"
            />
          </div>

          {/* Targeted & Blocked Countries Trigger Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsTargetedModalOpen(true)}
              className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#202026] text-left hover:border-[#9273fc] transition flex items-center justify-between cursor-pointer"
            >
              <div>
                <div className="text-xs font-bold text-gray-900 dark:text-white">Targeted Countries</div>
                <div className="text-[10px] text-gray-400">
                  {targetedCountries.length === 0 ? 'All Countries Allowed' : `${targetedCountries.length} countries selected`}
                </div>
              </div>
              <Globe className="w-4 h-4 text-[#9273fc]" />
            </button>

            <button
              type="button"
              onClick={() => setIsBlockedModalOpen(true)}
              className="p-3 rounded-xl border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-[#202026] text-left hover:border-red-500 transition flex items-center justify-between cursor-pointer"
            >
              <div>
                <div className="text-xs font-bold text-gray-900 dark:text-white">Blocked Countries</div>
                <div className="text-[10px] text-gray-400">
                  {blockedCountries.length === 0 ? 'No Blocked Countries' : `${blockedCountries.length} countries blocked`}
                </div>
              </div>
              <X className="w-4 h-4 text-red-500" />
            </button>
          </div>
        </div>

        {/* Submit Actions */}
        <div className="flex items-center gap-3">
          <Link
            href="/my-ads"
            className="flex-1 py-3 text-center border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-300 rounded-xl font-bold text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition"
          >
            Cancel
          </Link>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-2 py-3 bg-[#9273fc] hover:bg-[#8160f5] text-white rounded-xl font-bold text-sm transition shadow-md shadow-[#9273fc]/25 disabled:opacity-50 cursor-pointer active:scale-[0.99]"
          >
            {isSubmitting ? 'Saving Changes...' : 'Save & Publish Changes'}
          </button>
        </div>
      </form>

      {/* MODAL: Change Fiat */}
      {isFiatModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-[#18181c] rounded-2xl max-w-md w-full max-h-[80vh] flex flex-col shadow-2xl border border-gray-200 dark:border-gray-800">
            <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 dark:text-white text-sm">Change Fiat Currency</h3>
              <button type="button" onClick={() => setIsFiatModalOpen(false)}>
                <X className="w-4 h-4 text-gray-500 hover:text-gray-700 dark:text-gray-400" />
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
                  className="w-full pl-9 pr-4 py-1.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] text-gray-900 dark:text-white rounded-xl text-xs focus:ring-1 focus:ring-[#9273fc] focus:outline-hidden"
                />
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
                  className="w-full flex items-center justify-between p-2.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-800/60 rounded-xl transition cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <img
                      src={`https://flagcdn.com/w40/${item.flag}.png`}
                      alt={item.code}
                      className="w-5 h-3.5 object-cover rounded-[2px]"
                    />
                    <div>
                      <div className="font-bold text-gray-800 dark:text-gray-200">{item.name}</div>
                      <div className="text-[10px] text-gray-400">{item.code}</div>
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
          <div className="bg-white dark:bg-[#18181c] rounded-2xl max-w-md w-full max-h-[80vh] flex flex-col shadow-2xl border border-gray-200 dark:border-gray-800">
            <div className="p-4 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between">
              <h3 className="font-bold text-gray-900 dark:text-white text-sm">
                {isTargetedModalOpen ? 'Select Targeted Countries' : 'Select Blocked Countries'}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setIsTargetedModalOpen(false);
                  setIsBlockedModalOpen(false);
                }}
              >
                <X className="w-4 h-4 text-gray-500 hover:text-gray-700 dark:text-gray-400" />
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
                  className="w-full pl-9 pr-4 py-1.5 border border-gray-200 dark:border-gray-700 bg-white dark:bg-[#202026] text-gray-900 dark:text-white rounded-xl text-xs focus:ring-1 focus:ring-[#9273fc] focus:outline-hidden"
                />
              </div>
              <button
                type="button"
                onClick={() => {
                  if (isTargetedModalOpen) setTargetedCountries([]);
                  else setBlockedCountries([]);
                }}
                className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-xl text-[11px] text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800"
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
                    className="w-full flex items-center justify-between p-2.5 text-left text-xs hover:bg-gray-50 dark:hover:bg-gray-800/60 rounded-xl transition cursor-pointer"
                  >
                    <div className="flex items-center gap-3">
                      <img
                        src={`https://flagcdn.com/w40/${country.code}.png`}
                        alt={country.name}
                        className="w-5 h-3.5 object-cover rounded-[2px]"
                      />
                      <span className="text-gray-800 dark:text-gray-200 font-medium">{country.name}</span>
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
