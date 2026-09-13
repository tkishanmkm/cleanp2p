'use client';

import React from 'react';

interface CurrencyIconProps {
  symbol: string;
  size?: 'sm' | 'md' | 'lg';
  showCode?: boolean;
}

const CRYPTO_ICONS: Record<string, { symbolChar: string; bg: string; text: string; border: string; name: string }> = {
  BTC: { symbolChar: '₿', bg: 'bg-amber-500/15 dark:bg-amber-500/20', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/30', name: 'Bitcoin' },
  ETH: { symbolChar: 'Ξ', bg: 'bg-indigo-500/15 dark:bg-indigo-500/20', text: 'text-indigo-600 dark:text-indigo-400', border: 'border-indigo-500/30', name: 'Ethereum' },
  USDT: { symbolChar: '₮', bg: 'bg-emerald-500/15 dark:bg-emerald-500/20', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/30', name: 'Tether' },
  USDC: { symbolChar: '$', bg: 'bg-blue-500/15 dark:bg-blue-500/20', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500/30', name: 'USD Coin' },
  LTC: { symbolChar: 'Ł', bg: 'bg-sky-500/15 dark:bg-sky-500/20', text: 'text-sky-600 dark:text-sky-400', border: 'border-sky-500/30', name: 'Litecoin' },
  SOL: { symbolChar: '◎', bg: 'bg-purple-500/15 dark:bg-purple-500/20', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-500/30', name: 'Solana' },
  BNB: { symbolChar: '🔶', bg: 'bg-yellow-500/15 dark:bg-yellow-500/20', text: 'text-yellow-600 dark:text-yellow-400', border: 'border-yellow-500/30', name: 'BNB' },
  TRX: { symbolChar: '⚡', bg: 'bg-red-500/15 dark:bg-red-500/20', text: 'text-red-600 dark:text-red-400', border: 'border-red-500/30', name: 'TRON' },
  MATIC: { symbolChar: '⬡', bg: 'bg-violet-500/15 dark:bg-violet-500/20', text: 'text-violet-600 dark:text-violet-400', border: 'border-violet-500/30', name: 'Polygon' },
  DOGE: { symbolChar: 'Ð', bg: 'bg-amber-600/15 dark:bg-amber-600/20', text: 'text-amber-700 dark:text-amber-500', border: 'border-amber-600/30', name: 'Dogecoin' },
  XRP: { symbolChar: '✕', bg: 'bg-cyan-500/15 dark:bg-cyan-500/20', text: 'text-cyan-600 dark:text-cyan-400', border: 'border-cyan-500/30', name: 'Ripple' },
};

const FIAT_FLAGS: Record<string, { flag: string; name: string }> = {
  USD: { flag: '🇺🇸', name: 'US Dollar' },
  EUR: { flag: '🇪🇺', name: 'Euro' },
  GBP: { flag: '🇬🇧', name: 'British Pound' },
  INR: { flag: '🇮🇳', name: 'Indian Rupee' },
  CAD: { flag: '🇨🇦', name: 'Canadian Dollar' },
  AUD: { flag: '🇦🇺', name: 'Australian Dollar' },
  JPY: { flag: '🇯🇵', name: 'Japanese Yen' },
  CNY: { flag: '🇨🇳', name: 'Chinese Yuan' },
  BRL: { flag: '🇧🇷', name: 'Brazilian Real' },
  AED: { flag: '🇦🇪', name: 'UAE Dirham' },
  NGN: { flag: '🇳🇬', name: 'Nigerian Naira' },
  RUB: { flag: '🇷🇺', name: 'Russian Ruble' },
  TRY: { flag: '🇹🇷', name: 'Turkish Lira' },
};

export function CurrencyIcon({ symbol, size = 'md', showCode = true }: CurrencyIconProps) {
  const sym = symbol?.toUpperCase() || 'BTC';
  const isCrypto = Boolean(CRYPTO_ICONS[sym]);
  const fiatData = FIAT_FLAGS[sym];

  const dimensions = {
    sm: 'w-5 h-5 text-xs',
    md: 'w-7 h-7 text-sm',
    lg: 'w-9 h-9 text-base',
  }[size];

  if (fiatData) {
    return (
      <div className="inline-flex items-center gap-1.5 font-bold tracking-tight">
        <span className="text-base select-none leading-none" role="img" aria-label={sym}>
          {fiatData.flag}
        </span>
        {showCode && <span className="font-bold text-foreground text-sm">{sym}</span>}
      </div>
    );
  }

  const cryptoData = CRYPTO_ICONS[sym] || {
    symbolChar: sym[0] || '●',
    bg: 'bg-slate-500/15 dark:bg-slate-500/20',
    text: 'text-slate-700 dark:text-slate-300',
    border: 'border-slate-500/30',
    name: sym,
  };

  return (
    <div className="inline-flex items-center gap-1.5 font-bold tracking-tight">
      <span
        className={`inline-flex items-center justify-center font-black rounded-full border shrink-0 ${dimensions} ${cryptoData.bg} ${cryptoData.text} ${cryptoData.border}`}
      >
        {cryptoData.symbolChar}
      </span>
      {showCode && <span className="font-bold text-foreground text-sm">{sym}</span>}
    </div>
  );
}

export default CurrencyIcon;
