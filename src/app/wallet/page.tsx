'use client';

import React, { useState, useEffect } from 'react';
import { createClient } from '@supabase/supabase-js';
import { WalletBalanceCard } from '@/components/wallet/WalletBalanceCard';
import { WithdrawalDialog } from '@/components/wallet/WithdrawalDialog';
import { TransactionHistory } from '@/components/wallet/TransactionHistory';
import { DepositDialog } from '@/components/wallets/deposit-dialog';
import { AdminWorkerPanel } from '@/components/wallet/AdminWorkerPanel';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export default function WalletPage() {
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const [availableBalance, setAvailableBalance] = useState(0);

  const fetchLiveBalance = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      const { data: balanceData } = await supabase
        .from('balances')
        .select('available_balance')
        .eq('user_id', session.user.id)
        .eq('asset_code', 'USDT')
        .maybeSingle();

      if (balanceData && typeof balanceData.available_balance === 'number') {
        setAvailableBalance(balanceData.available_balance);
      }
    } catch (err) {
      console.warn('Failed to load available balance in WalletPage:', err);
    }
  };

  useEffect(() => {
    fetchLiveBalance();
  }, [isWithdrawOpen, isDepositOpen]);

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* 1. Unified Portfolio Balance Header */}
      <WalletBalanceCard
        assetSymbol="USDT"
        onOpenDeposit={() => setIsDepositOpen(true)}
        onOpenWithdraw={() => setIsWithdrawOpen(true)}
      />

      {/* 2. Real-time Transaction Ledger */}
      <TransactionHistory />

      {/* 3. Dev / Admin Worker Control Panel */}
      <AdminWorkerPanel />

      {/* 4. Withdrawal Dialog Modal */}
      <WithdrawalDialog
        isOpen={isWithdrawOpen}
        onClose={() => setIsWithdrawOpen(false)}
        availableBalance={availableBalance}
        assetSymbol="USDT"
        chain="BEP20"
        onSuccess={() => {
          fetchLiveBalance();
        }}
      />

      {/* 5. Deposit Dialog Modal */}
      <DepositDialog
        open={isDepositOpen}
        onOpenChange={setIsDepositOpen}
        asset="USDT"
      />
    </div>
  );
}
