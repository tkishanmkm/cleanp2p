'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

export interface BalanceState {
  total: number;
  available: number;
  locked: number;
}

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
  const [balance, setBalance] = useState<BalanceState>({
    total: 0,
    available: 0,
    locked: 0,
  });
  const [loading, setLoading] = useState(true);

  const fetchBalance = async () => {
    try {
      setLoading(true);
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // 1. Fetch available balance from balances table
      const { data: balanceData } = await supabase
        .from('balances')
        .select('total_balance, available_balance')
        .eq('user_id', session.user.id)
        .eq('asset_code', assetSymbol)
        .maybeSingle();

      // 2. Calculate locked balance from pending/processing withdrawals
      const { data: pendingWithdrawals } = await supabase
        .from('withdrawals')
        .select('amount')
        .eq('user_id', session.user.id)
        .eq('asset', assetSymbol)
        .in('status', ['pending', 'processing']);

      const lockedAmount = (pendingWithdrawals || []).reduce(
        (acc, item) => acc + (Number(item.amount) || 0),
        0
      );

      const availableVal = Number(balanceData?.available_balance) || 0;
      const totalVal = Number(balanceData?.total_balance) || availableVal + lockedAmount;

      setBalance({
        total: totalVal,
        available: availableVal,
        locked: lockedAmount,
      });
    } catch (err) {
      console.error('Error fetching balance summary:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBalance();

    // Subscribe to balance and withdrawal table changes for real-time adjustments
    const channel = supabase
      .channel('balance_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'balances' }, fetchBalance)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'withdrawals' }, fetchBalance)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [assetSymbol]);

  return (
    <div className="w-full rounded-xl bg-gray-900 p-6 text-white border border-gray-800 shadow-lg">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400">
            Total Portfolio Balance
          </span>
          <div className="text-3xl font-extrabold tracking-tight text-white mt-1">
            {loading ? (
              <span className="animate-pulse text-gray-600">0.0000</span>
            ) : (
              `${balance.total.toFixed(4)} ${assetSymbol}`
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={onOpenDeposit}
            className="rounded-lg bg-emerald-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-emerald-500 transition-all focus:outline-none focus:ring-2 focus:ring-emerald-500/50"
          >
            Deposit
          </button>
          <button
            onClick={onOpenWithdraw}
            className="rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-blue-500 transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/50"
          >
            Withdraw
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 border-t border-gray-800/80 pt-4">
        <div className="rounded-lg bg-gray-800/40 p-3 border border-gray-800">
          <span className="text-xs text-gray-400 block mb-1">Available to Spend</span>
          <span className="text-base font-semibold text-emerald-400">
            {loading ? '...' : `${balance.available.toFixed(4)} ${assetSymbol}`}
          </span>
        </div>

        <div className="rounded-lg bg-gray-800/40 p-3 border border-gray-800">
          <span className="text-xs text-gray-400 block mb-1">Locked in Escrow</span>
          <span className="text-base font-semibold text-amber-400">
            {loading ? '...' : `${balance.locked.toFixed(4)} ${assetSymbol}`}
          </span>
        </div>
      </div>
    </div>
  );
}
