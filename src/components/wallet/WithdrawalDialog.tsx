'use client';

import React, { useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

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
      // Get current authenticated user session token
      const { data: { session }, error: sessionError } = await supabase.auth.getSession();
      if (sessionError || !session) {
        throw new Error('User authentication required.');
      }

      // Submit withdrawal request to DB / API endpoint
      const { error: dbError } = await supabase.from('withdrawals').insert({
        user_id: session.user.id,
        asset: assetSymbol,
        chain: chain,
        amount: numericAmount,
        destination_address: destinationAddress,
        status: 'pending',
      });

      if (dbError) throw new Error(dbError.message);

      // Trigger successful callback
      if (onSuccess) onSuccess();
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to request withdrawal.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-gray-900 p-6 text-white shadow-xl border border-gray-800">
        <h2 className="text-xl font-bold mb-4">Withdraw {assetSymbol}</h2>

        {errorMsg && (
          <div className="mb-4 rounded bg-red-900/50 p-3 text-sm text-red-200 border border-red-700">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Available Balance
            </label>
            <div className="text-lg font-semibold text-emerald-400">
              {availableBalance} {assetSymbol}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Destination Address ({chain})
            </label>
            <input
              type="text"
              required
              value={destinationAddress}
              onChange={(e) => setDestinationAddress(e.target.value)}
              placeholder={`Enter ${chain} destination address`}
              className="w-full rounded bg-gray-800 px-3 py-2 text-sm text-white border border-gray-700 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Amount
            </label>
            <input
              type="number"
              step="any"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              className="w-full rounded bg-gray-800 px-3 py-2 text-sm text-white border border-gray-700 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded px-4 py-2 text-sm font-medium text-gray-400 hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {isSubmitting ? 'Submitting...' : 'Confirm Withdrawal'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
