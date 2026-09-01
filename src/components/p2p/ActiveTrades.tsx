'use client';

import { useState, useEffect } from 'react';

interface Trade {
  id: string;
  order_id: string;
  seller_id: string;
  buyer_id: string;
  amount: number;
  fiat_amount: number;
  status: 'PENDING_PAYMENT' | 'PAID' | 'COMPLETED' | 'CANCELLED' | 'DISPUTED';
  created_at: string;
}

export default function ActiveTrades({ currentUserId }: { currentUserId: string }) {
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  useEffect(() => {
    fetchTrades();
  }, []);

  async function fetchTrades() {
    try {
      setLoading(true);
      const res = await fetch('/api/p2p/trades', {
        credentials: 'include',
      });
      const data = await res.json();
      if (data.success) {
        setTrades(data.trades || []);
      } else {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to fetch trades');
    } finally {
      setLoading(false);
    }
  }

  async function handleReleaseEscrow(tradeId: string) {
    try {
      setActionLoading(tradeId);
      const res = await fetch('/api/p2p/trade/release', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tradeId }),
      });
      const data = await res.json();
      if (data.success) {
        fetchTrades();
      } else {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to release escrow');
    } finally {
      setActionLoading(null);
    }
  }

  async function handleCancelTrade(tradeId: string) {
    try {
      setActionLoading(tradeId);
      const res = await fetch('/api/p2p/trade/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tradeId }),
      });
      const data = await res.json();
      if (data.success) {
        fetchTrades();
      } else {
        setError(data.error);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to cancel trade');
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 bg-slate-900 text-slate-100 rounded-xl shadow-lg border border-slate-800 space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Active P2P Trades</h2>
        <button
          onClick={fetchTrades}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-sm font-medium rounded-lg border border-slate-700 transition"
        >
          Refresh Trades
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-950 border border-red-800 text-red-200 rounded-lg text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-8 text-slate-400">Loading trades...</div>
      ) : trades.length === 0 ? (
        <div className="text-center py-8 text-slate-400">No active trades found.</div>
      ) : (
        <div className="space-y-4">
          {trades.map((trade) => {
            const isSeller = trade.seller_id === currentUserId;
            return (
              <div key={trade.id} className="p-5 bg-slate-950 border border-slate-800 rounded-xl flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-indigo-400">Trade #{trade.id.slice(0, 8)}</span>
                    <span className={`px-2 py-0.5 text-xs rounded font-semibold ${trade.status === 'COMPLETED' ? 'bg-emerald-950 text-emerald-400' : 'bg-amber-950 text-amber-400'}`}>
                      {trade.status}
                    </span>
                  </div>
                  <p className="text-sm text-slate-300 font-mono">
                    Amount: <strong className="text-slate-100">{trade.amount} USDT</strong> | Fiat Value: <strong className="text-slate-100">{trade.fiat_amount}</strong>
                  </p>
                  <p className="text-xs text-slate-500">
                    Role: {isSeller ? 'Seller (Escrow Locked)' : 'Buyer'}
                  </p>
                </div>

                <div className="flex items-center gap-2 w-full md:w-auto">
                  {trade.status === 'PENDING_PAYMENT' && isSeller && (
                    <button
                      onClick={() => handleReleaseEscrow(trade.id)}
                      disabled={actionLoading === trade.id}
                      className="flex-1 md:flex-none px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition"
                    >
                      {actionLoading === trade.id ? 'Releasing...' : 'Release Escrow'}
                    </button>
                  )}
                  {trade.status === 'PENDING_PAYMENT' && (
                    <button
                      onClick={() => handleCancelTrade(trade.id)}
                      disabled={actionLoading === trade.id}
                      className="flex-1 md:flex-none px-4 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition"
                    >
                      {actionLoading === trade.id ? 'Cancelling...' : 'Cancel Trade'}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
