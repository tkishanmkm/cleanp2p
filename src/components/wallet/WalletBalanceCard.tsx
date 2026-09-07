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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Total {symbol} Balance
          </span>
          <div className="text-3xl font-extrabold tracking-tight text-white mt-1">
            {isLoading ? (
              <span className="animate-pulse text-gray-600">0.0000</span>
            ) : (
              `${assetData.total.toFixed(4)} ${symbol}`
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-gray-800/80 pt-4">
        <div className="rounded-lg bg-gray-800/40 p-3 border border-gray-800">
          <span className="text-xs text-gray-400 block mb-1">Available to Spend</span>
          <span className="text-base font-semibold text-emerald-400 font-mono">
            {isLoading ? '...' : `${assetData.available.toFixed(4)} ${symbol}`}
          </span>
        </div>

        <div className="rounded-lg bg-gray-800/40 p-3 border border-gray-800">
          <span className="text-xs text-gray-400 block mb-1">In P2P Escrow</span>
          <span className="text-base font-semibold text-amber-400 font-mono">
            {isLoading ? '...' : `${assetData.inEscrow.toFixed(4)} ${symbol}`}
          </span>
        </div>

        <div className="rounded-lg bg-gray-800/40 p-3 border border-gray-800">
          <span className="text-xs text-gray-400 block mb-1">Pending Withdrawal</span>
          <span className="text-base font-semibold text-blue-400 font-mono">
            {isLoading ? '...' : `${assetData.inWithdrawal.toFixed(4)} ${symbol}`}
          </span>
        </div>
      </div>
    </div>
  );
}

export default WalletBalanceCard;
