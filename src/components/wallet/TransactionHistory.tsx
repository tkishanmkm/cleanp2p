'use client';

import React, { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase/client';

export interface Transaction {
  id: string;
  type: 'deposit' | 'withdrawal';
  asset: string;
  chain: string;
  amount: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  tx_hash?: string;
  created_at: string;
}

export function TransactionHistory() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Fetch both deposits and withdrawals for the user
      const [depositsRes, withdrawalsRes] = await Promise.all([
        supabase
          .from('deposits')
          .select('*')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false }),
        supabase
          .from('withdrawals')
          .select('*')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false }),
      ]);

      const formattedDeposits: Transaction[] = (depositsRes.data || []).map((d) => ({
        id: d.id,
        type: 'deposit',
        asset: d.asset,
        chain: d.chain,
        amount: d.amount,
        status: d.status,
        tx_hash: d.tx_hash,
        created_at: d.created_at,
      }));

      const formattedWithdrawals: Transaction[] = (withdrawalsRes.data || []).map((w) => ({
        id: w.id,
        type: 'withdrawal',
        asset: w.asset,
        chain: w.chain,
        amount: w.amount,
        status: w.status,
        tx_hash: w.tx_hash,
        created_at: w.created_at,
      }));

      // Combine and sort chronologically
      const merged = [...formattedDeposits, ...formattedWithdrawals].sort(
        (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );

      setTransactions(merged);
    } catch (err) {
      console.error('Failed to load transaction history:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTransactions();

    // Subscribe to real-time status updates on withdrawals and deposits
    const channel = supabase
      .channel('wallet_updates')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'withdrawals' }, fetchTransactions)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deposits' }, fetchTransactions)
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const getStatusBadge = (status: Transaction['status']) => {
    switch (status) {
      case 'completed':
        return <span className="rounded bg-emerald-900/40 px-2 py-0.5 text-xs text-emerald-300 border border-emerald-700/50">Completed</span>;
      case 'processing':
      case 'pending':
        return <span className="rounded bg-amber-900/40 px-2 py-0.5 text-xs text-amber-300 border border-amber-700/50">Processing</span>;
      case 'failed':
        return <span className="rounded bg-red-900/40 px-2 py-0.5 text-xs text-red-300 border border-red-700/50">Failed</span>;
    }
  };

  return (
    <div className="w-full rounded-lg bg-gray-900 p-6 text-white border border-gray-800">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-bold">Transaction History</h3>
        <button
          onClick={fetchTransactions}
          className="text-xs text-gray-400 hover:text-white transition-colors"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="py-8 text-center text-sm text-gray-400">Loading transactions...</div>
      ) : transactions.length === 0 ? (
        <div className="py-8 text-center text-sm text-gray-500">No transactions found.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm text-gray-300">
            <thead className="border-b border-gray-800 text-xs uppercase text-gray-400">
              <tr>
                <th className="py-3 px-2">Type</th>
                <th className="py-3 px-2">Asset</th>
                <th className="py-3 px-2">Amount</th>
                <th className="py-3 px-2">Status</th>
                <th className="py-3 px-2">Date</th>
                <th className="py-3 px-2">Tx Hash</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {transactions.map((tx) => (
                <tr key={tx.id} className="hover:bg-gray-800/30">
                  <td className="py-3 px-2 font-medium capitalize">
                    <span className={tx.type === 'deposit' ? 'text-emerald-400' : 'text-blue-400'}>
                      {tx.type}
                    </span>
                  </td>
                  <td className="py-3 px-2">{tx.asset} <span className="text-xs text-gray-500">({tx.chain})</span></td>
                  <td className="py-3 px-2 font-mono">
                    {tx.type === 'deposit' ? '+' : '-'}{tx.amount}
                  </td>
                  <td className="py-3 px-2">{getStatusBadge(tx.status)}</td>
                  <td className="py-3 px-2 text-xs text-gray-400">
                    {new Date(tx.created_at).toLocaleString()}
                  </td>
                  <td className="py-3 px-2 text-xs font-mono text-gray-500">
                    {tx.tx_hash ? `${tx.tx_hash.substring(0, 8)}...` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default TransactionHistory;
