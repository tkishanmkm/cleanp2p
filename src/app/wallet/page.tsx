'use client';

import React, { useState } from 'react';
import { useWallet } from '@/context/wallet-context';
import { TotalBalanceCard } from '@/components/wallet/TotalBalanceCard';
import { WalletBalanceCard } from '@/components/wallet/WalletBalanceCard';
import { WithdrawalDialog } from '@/components/wallet/WithdrawalDialog';
import { TransactionHistory } from '@/components/wallet/TransactionHistory';
import { DepositDialog } from '@/components/wallets/deposit-dialog';
import { AdminWorkerPanel } from '@/components/wallet/AdminWorkerPanel';

export default function WalletPage() {
  const [isDepositOpen, setIsDepositOpen] = useState(false);
  const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);
  const { totalAvailableUsdValue, balances, refreshBalances } = useWallet();

  const usdtAvailable = balances['USDT']?.available || 0;

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* 0. Total Balance Overview */}
      <TotalBalanceCard totalUsdValue={totalAvailableUsdValue} />

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
        availableBalance={usdtAvailable}
        assetSymbol="USDT"
        chain="BEP20"
        onSuccess={() => {
          refreshBalances();
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
