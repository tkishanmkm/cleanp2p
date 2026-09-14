'use client';

import React from 'react';
import { useWallet } from '@/context/wallet-context';
import { Wallet } from 'lucide-react';
import Link from 'next/link';

export interface NavbarWalletProps {
  balance?: number | string;
  currency?: string;
  isLoading?: boolean;
  className?: string;
  showIcon?: boolean;
}

/**
 * NavbarWallet Component
 * Strictly displays only the available balance formatted with 2 decimal places.
 * Accepts optional explicit balance/currency props or falls back to wallet context.
 */
export function NavbarWallet({
  balance,
  currency,
  isLoading: propLoading,
  className = '',
  showIcon = true,
}: NavbarWalletProps) {
  const walletContext = useWallet();

  const loading = propLoading !== undefined ? propLoading : walletContext.isLoading;
  const currentCurrency = currency || walletContext.preferredCurrency || 'USD';

  // Compute display balance: explicit prop takes precedence, else context available balance
  let displayBalance: number = 0;
  if (balance !== undefined) {
    displayBalance = typeof balance === 'string' ? parseFloat(balance) || 0 : balance;
  } else {
    displayBalance = walletContext.totalConvertedValue || 0;
  }

  if (loading) {
    return (
      <div className={`flex items-center gap-1.5 px-2 py-1 rounded-lg bg-muted/40 animate-pulse ${className}`}>
        {showIcon && <Wallet className="h-3.5 w-3.5 text-muted-foreground" />}
        <span className="text-xs font-mono font-bold text-muted-foreground">--.--</span>
      </div>
    );
  }

  return (
    <Link
      href="/wallets"
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-slate-100/80 dark:bg-slate-800/80 hover:bg-slate-200 dark:hover:bg-slate-700/80 border border-slate-200/80 dark:border-slate-800 transition-colors shadow-xs group cursor-pointer ${className}`}
      title="Available Balance"
    >
      {showIcon && (
        <Wallet className="h-3.5 w-3.5 text-emerald-500 shrink-0 group-hover:scale-105 transition-transform" />
      )}
      <span className="text-xs font-mono font-bold text-emerald-600 dark:text-emerald-400">
        {displayBalance.toLocaleString('en-US', {
          style: 'currency',
          currency: currentCurrency,
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}
      </span>
    </Link>
  );
}

export default NavbarWallet;
