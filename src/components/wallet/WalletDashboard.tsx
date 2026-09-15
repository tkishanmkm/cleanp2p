'use client';

import { useState, useEffect } from 'react';

interface Wallet {
  id: string;
  asset_symbol: string;
  balance: number;
  locked_balance: number;
  updated_at?: string;
}

export default function WalletDashboard({ userId }: { userId?: string }) {
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [actionType, setActionType] = useState<'DEPOSIT' | 'WITHDRAW'>('DEPOSIT');
  const [assetSymbol, setAssetSymbol] = useState('USDT');
  const [amount, setAmount] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    fetchWallets();
  }, [userId]);

  async function fetchWallets() {
    try {
      setLoading(true);
      const res = await fetch('/api/wallet/balance', {
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        setWallets(data.wallets || []);
      } else {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch wallet balances');
    } finally {
      setLoading(false);
    }
  }

  async function handleLedgerAction(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    const endpoint = actionType === 'DEPOSIT' ? '/api/wallet/deposit' : '/api/wallet/withdraw';

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          assetSymbol,
          amount: Number(amount),
        }),
      });

      const data = await res.json();
      if (data.success) {
        setSuccessMsg(`Successfully processed ${actionType.toLowerCase()} of ${amount} ${assetSymbol}`);
        setAmount('');
        fetchWallets();
      } else {
        setError(data.error || 'Transaction failed');
      }
    } catch (err: any) {
      setError(err.message || 'Transaction failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 bg-slate-900 text-slate-100 rounded-xl shadow-lg border border-slate-800 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Wallet & Escrow Balances</h2>
        <button
          onClick={fetchWallets}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-sm font-medium rounded-lg border border-slate-700 transition"
        >
          Refresh Balances
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-950 border border-red-800 text-red-200 rounded-lg text-sm">
          {error}
        </div>
      )}

      {successMsg && (
        <div className="p-4 bg-emerald-950 border border-emerald-800 text-emerald-200 rounded-lg text-sm">
          {successMsg}
        </div>
      )}

      {/* Wallet Cards */}
      {loading ? (
        <div className="text-center py-8 text-slate-400">Loading wallets...</div>
      ) : wallets.length === 0 ? (
        <div className="text-center py-8 text-slate-400">No active wallets found. Deposit funds to get started.</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {wallets.map((wallet) => (
            <div key={wallet.id} className="p-5 bg-slate-950 border border-slate-800 rounded-xl space-y-3">
              <div className="flex justify-between items-center">
                <span className="font-bold text-lg text-indigo-400">{wallet.asset_symbol}</span>
                <span className="text-xs text-slate-500 font-mono">ID: {wallet.id.slice(0, 8)}...</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm pt-2 border-t border-slate-900">
                <div>
                  <span className="text-slate-400 text-xs block">Available Balance</span>
                  <span className="font-mono font-bold text-emerald-400 text-base">{wallet.balance}</span>
                </div>
                <div>
                  <span className="text-slate-400 text-xs block">In P2P Escrow</span>
                  <span className="font-mono font-bold text-amber-400 text-base">{wallet.locked_balance}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Deposit / Withdrawal Form */}
      <div className="p-6 bg-slate-950 border border-slate-800 rounded-xl">
        <h3 className="text-lg font-semibold mb-4">Manage Funds</h3>
        <form onSubmit={handleLedgerAction} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Action Type</label>
              <select
                value={actionType}
                onChange={(e) => setActionType(e.target.value as 'DEPOSIT' | 'WITHDRAW')}
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-indigo-500"
              >
                <option value="DEPOSIT">Deposit Funds</option>
                <option value="WITHDRAW">Withdraw Funds</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Asset Symbol</label>
              <input
                type="text"
                value={assetSymbol}
                onChange={(e) => setAssetSymbol(e.target.value.toUpperCase())}
                required
                className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Amount</label>
            <input
              type="number"
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              required
              className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-slate-100 focus:outline-none focus:border-indigo-500 font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-semibold rounded-lg transition"
          >
            {submitting ? 'Processing...' : `Confirm ${actionType}`}
          </button>
        </form>
      </div>
    </div>
  );
}
