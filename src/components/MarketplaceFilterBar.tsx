'use client';

import React, { useState } from 'react';
import { Search, ChevronDown, Check, Building2, Wallet, Smartphone, Banknote, Gift } from 'lucide-react';

// --- DATA STRUCTURES ---
export const CRYPTO_OPTIONS = [
  { code: 'ALL', name: 'All Coins', logo: '' },
  { code: 'BTC', name: 'Bitcoin', logo: 'https://cryptologos.cc/logos/bitcoin-btc-logo.svg?v=035' },
  { code: 'USDT', name: 'Tether', logo: 'https://cryptologos.cc/logos/tether-usdt-logo.svg?v=035' },
  { code: 'ETH', name: 'Ethereum', logo: 'https://cryptologos.cc/logos/ethereum-eth-logo.svg?v=035' },
  { code: 'LTC', name: 'Litecoin', logo: 'https://cryptologos.cc/logos/litecoin-ltc-logo.svg?v=035' },
];

export const FIAT_CURRENCIES = [
  { name: 'All Fiats', code: 'ALL', flag: '🌐' },
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

export const PAYMENT_CATEGORIES = [
  {
    id: 'all',
    title: 'All Payment Methods',
    icon: Wallet,
    subtitle: 'Show all available payment options.',
    options: ['ALL']
  },
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

export interface FilterState {
  side: 'BUY' | 'SELL';
  coin: string;
  fiat: string;
  paymentMethod: string;
  searchQuery: string;
}

interface FilterBarProps {
  initialSide: 'BUY' | 'SELL';
  btcPrice?: number;
  onFilterChange: (filters: FilterState) => void;
}

export default function MarketplaceFilterBar({ initialSide, btcPrice = 78932.04, onFilterChange }: FilterBarProps) {
  const [side, setSide] = useState<'BUY' | 'SELL'>(initialSide);
  const [selectedCoin, setSelectedCoin] = useState('BTC');
  const [selectedFiat, setSelectedFiat] = useState(FIAT_CURRENCIES[0]);
  const [selectedPayment, setSelectedPayment] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const [showFiatDropdown, setShowFiatDropdown] = useState(false);
  const [showPaymentDropdown, setShowPaymentDropdown] = useState(false);
  const [fiatSearch, setFiatSearch] = useState('');
  const [paymentSearch, setPaymentSearch] = useState('');

  const notifyChange = (override: Partial<FilterState> = {}) => {
    onFilterChange({
      side: override.side ?? side,
      coin: override.coin ?? selectedCoin,
      fiat: override.fiat ?? selectedFiat.code,
      paymentMethod: override.paymentMethod ?? selectedPayment,
      searchQuery: override.searchQuery ?? searchQuery
    });
  };

  const handleSideChange = (newSide: 'BUY' | 'SELL') => {
    setSide(newSide);
    notifyChange({ side: newSide });
  };

  const handleCoinChange = (coin: string) => {
    setSelectedCoin(coin);
    notifyChange({ coin });
  };

  const handleFiatSelect = (fiatObj: typeof FIAT_CURRENCIES[0]) => {
    setSelectedFiat(fiatObj);
    setShowFiatDropdown(false);
    notifyChange({ fiat: fiatObj.code });
  };

  const handlePaymentSelect = (method: string) => {
    setSelectedPayment(method);
    setShowPaymentDropdown(false);
    notifyChange({ paymentMethod: method });
  };

  const filteredFiats = FIAT_CURRENCIES.filter(f =>
    f.code.toLowerCase().includes(fiatSearch.toLowerCase()) ||
    f.name.toLowerCase().includes(fiatSearch.toLowerCase())
  );

  return (
    <div className="w-full bg-slate-900 text-white rounded-2xl p-6 shadow-2xl border border-slate-800 space-y-6">
      {/* Dynamic Header */}
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 border-b border-slate-800 pb-5">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            {side === 'BUY' ? 'Buy' : 'Sell'} {selectedCoin === 'ALL' ? 'Crypto' : selectedCoin} - Find Offers from {side === 'BUY' ? 'Sellers' : 'Buyers'}
          </h1>
          <p className="text-sm text-slate-400 mt-1">
            1 BTC ≈ ${btcPrice.toLocaleString('en-US', { minimumFractionDigits: 2 })}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-3 py-1.5 rounded-lg text-xs font-semibold">
            Academy
          </span>
          <button className="bg-indigo-600 hover:bg-indigo-500 text-xs font-bold px-4 py-2 rounded-lg transition-all shadow-lg shadow-indigo-600/30">
            Take Tour
          </button>
        </div>
      </div>

      {/* Buy / Sell Tabs + Coin Selector */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        {/* Buy / Sell Switch */}
        <div className="flex bg-slate-800 p-1 rounded-xl border border-slate-700">
          <button
            onClick={() => handleSideChange('BUY')}
            className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
              side === 'BUY' ? 'bg-emerald-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
            }`}
          >
            Buy
          </button>
          <button
            onClick={() => handleSideChange('SELL')}
            className={`px-6 py-2.5 rounded-lg text-sm font-bold transition-all ${
              side === 'SELL' ? 'bg-rose-600 text-white shadow-lg' : 'text-slate-400 hover:text-white'
            }`}
          >
            Sell
          </button>
        </div>

        {/* Crypto Logos Tabs */}
        <div className="flex items-center gap-1.5 bg-slate-800/80 p-1.5 rounded-xl border border-slate-700/60 overflow-x-auto">
          {CRYPTO_OPTIONS.map((coin) => (
            <button
              key={coin.code}
              onClick={() => handleCoinChange(coin.code)}
              className={`flex items-center gap-2 px-3.5 py-2 rounded-lg text-xs font-bold transition-all shrink-0 ${
                selectedCoin === coin.code
                  ? 'bg-indigo-600 text-white shadow-md'
                  : 'text-slate-400 hover:text-white hover:bg-slate-700/50'
              }`}
            >
              {coin.logo && <img src={coin.logo} alt={coin.name} className="w-4 h-4" />}
              <span>{coin.code}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Filter Controls: Fiat Dropdown, Payment Categories Dropdown, Search Input */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* 1. Fiat Dropdown */}
        <div className="relative">
          <label className="block text-xs font-semibold text-slate-400 mb-1.5">Currency (Fiat)</label>
          <button
            onClick={() => { setShowFiatDropdown(!showFiatDropdown); setShowPaymentDropdown(false); }}
            className="w-full flex items-center justify-between bg-slate-800 border border-slate-700 hover:border-slate-600 rounded-xl px-4 py-2.5 text-sm font-medium"
          >
            <span className="flex items-center gap-2 truncate">
              {selectedFiat.code !== 'ALL' && (
                <img
                  src={`https://flagcdn.com/w20/${selectedFiat.flag.toLowerCase()}.png`}
                  alt={selectedFiat.code}
                  className="w-4 h-3 object-cover rounded-sm"
                />
              )}
              <span>{selectedFiat.name} ({selectedFiat.code})</span>
            </span>
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
          </button>

          {showFiatDropdown && (
            <div className="absolute z-50 mt-2 w-full bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-3 space-y-2">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search Fiat Currency..."
                  value={fiatSearch}
                  onChange={(e) => setFiatSearch(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>
              <div className="max-h-56 overflow-y-auto space-y-1">
                {filteredFiats.map((fiat) => (
                  <button
                    key={fiat.code}
                    onClick={() => handleFiatSelect(fiat)}
                    className="w-full flex items-center justify-between px-3 py-2 text-xs rounded-lg hover:bg-slate-700 text-left transition"
                  >
                    <span className="flex items-center gap-2">
                      {fiat.code !== 'ALL' && (
                        <img
                          src={`https://flagcdn.com/w20/${fiat.flag.toLowerCase()}.png`}
                          alt={fiat.code}
                          className="w-4 h-3 object-cover rounded-sm"
                        />
                      )}
                      <span>{fiat.name} ({fiat.code})</span>
                    </span>
                    {selectedFiat.code === fiat.code && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 2. Categorized Payment Methods Dropdown */}
        <div className="relative">
          <label className="block text-xs font-semibold text-slate-400 mb-1.5">Payment Method</label>
          <button
            onClick={() => { setShowPaymentDropdown(!showPaymentDropdown); setShowFiatDropdown(false); }}
            className="w-full flex items-center justify-between bg-slate-800 border border-slate-700 hover:border-slate-600 rounded-xl px-4 py-2.5 text-sm font-medium"
          >
            <span className="truncate">{selectedPayment === 'ALL' ? 'All Payment Methods' : selectedPayment}</span>
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
          </button>

          {showPaymentDropdown && (
            <div className="absolute z-50 mt-2 w-full md:w-96 bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-3 space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search Payment Method..."
                  value={paymentSearch}
                  onChange={(e) => setPaymentSearch(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-9 pr-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div className="max-h-64 overflow-y-auto space-y-4 pr-1">
                {PAYMENT_CATEGORIES.map((cat) => {
                  const CategoryIcon = cat.icon;
                  const matchingOptions = cat.options.filter(opt =>
                    opt.toLowerCase().includes(paymentSearch.toLowerCase())
                  );

                  if (matchingOptions.length === 0) return null;

                  return (
                    <div key={cat.id} className="space-y-1.5">
                      <div className="flex items-center gap-2 px-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
                        <CategoryIcon className="w-3.5 h-3.5 text-indigo-400" />
                        <span>{cat.title}</span>
                      </div>
                      <div className="space-y-0.5">
                        {matchingOptions.map((opt) => (
                          <button
                            key={opt}
                            onClick={() => handlePaymentSelect(opt)}
                            className="w-full flex items-center justify-between px-3 py-1.5 text-xs rounded-lg hover:bg-slate-700 text-slate-200 text-left transition"
                          >
                            <span>{opt === 'ALL' ? 'All Payment Methods' : opt}</span>
                            {selectedPayment === opt && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* 3. Offer Keyword Search */}
        <div>
          <label className="block text-xs font-semibold text-slate-400 mb-1.5">Search Offers</label>
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3.5 top-3 text-slate-400" />
            <input
              type="text"
              placeholder="Search by payment or user..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                notifyChange({ searchQuery: e.target.value });
              }}
              className="w-full bg-slate-800 border border-slate-700 hover:border-slate-600 rounded-xl pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
