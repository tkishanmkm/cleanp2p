'use client';

import React from 'react';
import { useWallet } from '@/context/wallet-context';
import type { CryptoCurrency } from '@/lib/types';

interface WalletBalanceCardProps {
  assetSymbol?: string;
  onOpenDeposit: () => void;
  onOpenWithdraw: () => void;
}

export function WalletBalanceCard({
  assetSymbol = 'USDT',
  onOpenDeposit,
  onOpenWithdraw,
}: WalletBalanceCardProps) {
  const { balances, isLoading } = useWallet();
  const symbol = (assetSymbol.toUpperCase() as CryptoCurrency) || 'USDT';
  const assetData = balances[symbol] || { available: 0, inEscrow: 0, inWithdrawal: 0, total: 0, fiatValue: 0 };

  return (
    <div className="w-full rounded-xl bg-gray-900 p-6 text-white border border-gray-800 shadow-lg">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Available {symbol} Balance
          </span>
          <div className="text-3xl font-extrabold tracking-tight text-white mt-1">
            {isLoading ? (
              <span className="animate-pulse text-gray-600">0.0000</span>
            ) : (
              `${assetData.available.toFixed(4)} ${symbol}`
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onOpenDeposit}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-emerald-500 transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/50 cursor-pointer"
          >
            Deposit
          </button>
          <button
            onClick={onOpenWithdraw}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-blue-500 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/50 cursor-pointer"
          >
            Withdraw
          </button>
        </div>
      </div>
    </div>
  );
}

export default WalletBalanceCard;
