'use client';

import React, { useState } from 'react';
import { useWallet } from '@/context/wallet-context';
import type { CryptoCurrency } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';

interface WithdrawalDialogProps {
  isOpen: boolean;
  onClose: () => void;
  availableBalance: number;
  assetSymbol?: string;
  chain?: string;
  onSuccess?: () => void;
}

export function WithdrawalDialog({
  isOpen,
  onClose,
  availableBalance,
  assetSymbol = 'USDT',
  chain = 'ETH',
  onSuccess,
}: WithdrawalDialogProps) {
  const [destinationAddress, setDestinationAddress] = useState('');
  const [amount, setAmount] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const { requestWithdrawal, refreshBalances } = useWallet();
  const { toast } = useToast();

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const numericAmount = parseFloat(amount);
    if (!numericAmount || numericAmount <= 0) {
      setErrorMsg('Please enter a valid amount.');
      return;
    }

    if (numericAmount > availableBalance) {
      setErrorMsg('Insufficient balance for this withdrawal.');
      return;
    }

    if (!destinationAddress.trim()) {
      setErrorMsg('Please enter a destination address.');
      return;
    }

    setIsSubmitting(true);

    try {
      const crypto = (assetSymbol.toUpperCase() as CryptoCurrency) || 'USDT';
      await requestWithdrawal(crypto, chain, destinationAddress.trim(), numericAmount, 0);

      toast({
        title: 'Withdrawal Submitted',
        description: `Successfully requested withdrawal of ${numericAmount} ${crypto}.`,
      });

      await refreshBalances();
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to request withdrawal.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4">
      <div className="w-full max-w-md rounded-xl bg-gray-900 p-6 text-white shadow-2xl border border-gray-800">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Withdraw {assetSymbol}</h2>
          <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-400 font-mono border border-blue-500/20">
            {chain} Network
          </span>
        </div>

        {errorMsg && (
          <div className="mb-4 rounded-lg bg-red-900/40 p-3 text-sm text-red-200 border border-red-700/60">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
              Available to Spend
            </label>
            <div className="text-lg font-bold font-mono text-emerald-400">
              {availableBalance.toFixed(6)} {assetSymbol}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
              Destination Address ({chain})
            </label>
            <input
              type="text"
              required
              value={destinationAddress}
              onChange={(e) => setDestinationAddress(e.target.value)}
              placeholder={`Enter ${chain} destination address`}
              className="w-full rounded-lg bg-gray-800 px-3.5 py-2.5 text-sm text-white border border-gray-700 focus:outline-none focus:border-blue-500 font-mono placeholder:text-gray-500"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400">
                Amount
              </label>
              <button
                type="button"
                onClick={() => setAmount(String(availableBalance))}
                className="text-xs text-blue-400 hover:text-blue-300 font-medium cursor-pointer"
              >
                Max ({availableBalance.toFixed(4)})
              </button>
            </div>
            <input
              type="number"
              step="any"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded-lg bg-gray-800 px-3.5 py-2.5 text-sm text-white border border-gray-700 focus:outline-none focus:border-blue-500 font-mono placeholder:text-gray-500"
            />
          </div>

          <div className="rounded-lg bg-gray-800/50 p-3 text-xs text-gray-400 border border-gray-800">
            Funds will be deducted immediately from your spendable balance. The transaction will be recorded with status <span className="text-blue-400 font-mono">PENDING</span> until on-chain broadcast completes.
          </div>

          <div className="flex justify-end space-x-3 pt-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-gray-400 hover:bg-gray-800 cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50 cursor-pointer shadow"
            >
              {isSubmitting ? 'Submitting...' : 'Confirm Withdrawal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default WithdrawalDialog;
