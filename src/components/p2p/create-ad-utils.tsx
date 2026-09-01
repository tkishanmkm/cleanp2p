'use client';

import { FlagIcon } from "@/components/ui/flag-icon";
import { BtcLogo, EthLogo, LtcLogo, UsdtLogo } from "@/components/icons";

export const SUPPORTED_CRYPTOS = [
  { symbol: 'USDT', name: 'Tether' },
  { symbol: 'BTC', name: 'Bitcoin' },
  { symbol: 'ETH', name: 'Ethereum' },
  { symbol: 'LTC', name: 'Litecoin' },
];

export const ALL_FIATS = [
  { code: 'USD', name: 'United States Dollar', country: 'US', symbol: '$' },
  { code: 'INR', name: 'Indian Rupee', country: 'IN', symbol: '₹' },
  { code: 'EUR', name: 'Euro', country: 'EU', symbol: '€' },
  { code: 'GBP', name: 'British Pound', country: 'GB', symbol: '£' },
  { code: 'CAD', name: 'Canadian Dollar', country: 'CA', symbol: '$' },
  { code: 'AUD', name: 'Australian Dollar', country: 'AU', symbol: '$' },
  { code: 'AED', name: 'United Arab Emirates Dirham', country: 'AE', symbol: 'AED' },
  { code: 'BRL', name: 'Brazilian Real', country: 'BR', symbol: 'R$' },
  { code: 'JPY', name: 'Japanese Yen', country: 'JP', symbol: '¥' },
  { code: 'SGD', name: 'Singapore Dollar', country: 'SG', symbol: '$' },
];

export function CryptoLogo({ crypto, className = "h-5 w-5" }: { crypto: string; className?: string }) {
  switch (crypto.toUpperCase()) {
    case 'BTC': return <BtcLogo className={className} />;
    case 'ETH': return <EthLogo className={className} />;
    case 'LTC': return <LtcLogo className={className} />;
    case 'USDT': return <UsdtLogo className={className} />;
    default: return null;
  }
}

export function FiatLogo({ countryCode, className = "w-5 h-auto rounded-sm" }: { countryCode: string; className?: string }) {
  return <FlagIcon countryCode={countryCode} className={className} />;
}
