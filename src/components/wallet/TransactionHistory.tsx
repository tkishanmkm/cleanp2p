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
  destination_address?: string;
  network_fee?: number;
  tx_hash?: string;
  created_at: string;
}

export function TransactionHistory() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTx, setSelectedTx] = useState<Transaction | null>(null);

  const fetchTransactions = async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      // Fetch deposits from history API (includes onchain_deposits + legacy deposits) and withdrawals
      const [depositsRes, withdrawalsRes] = await Promise.all([
        fetch('/api/wallet/history/deposits').then((r) => r.json()).catch(() => ({ deposits: [] })),
        supabase
          .from('withdrawals')
          .select('*')
          .eq('user_id', session.user.id)
          .order('created_at', { ascending: false }),
      ]);

      const formattedDeposits: Transaction[] = (depositsRes.deposits || []).map((d: any) => ({
        id: d.id || d.tx_hash,
        type: 'deposit',
        asset: d.asset_symbol || d.asset || d.asset_code || 'ETH',
        chain: d.network || d.chain || d.network_code || 'SEPOLIA',
        amount: Number(d.amount || 0),
        status: (d.status === 'credited' || d.status === 'confirmed' || d.status === 'CONFIRMED') ? 'completed' : 'pending',
        destination_address: d.address || d.to_address || d.deposit_address,
        tx_hash: d.tx_hash || d.txid,
        created_at: d.created_at || new Date().toISOString(),
      }));

      const formattedWithdrawals: Transaction[] = (withdrawalsRes.data || []).map((w) => ({
        id: w.id,
        type: 'withdrawal',
        asset: w.asset || w.asset_code || 'ETH',
        chain: w.chain || w.network_code || 'EVM',
        amount: Number(w.amount || 0),
        status: w.status,
        destination_address: w.destination_address || w.to_address || w.address,
        network_fee: w.network_fee ?? w.estimated_gas_fee ?? 0,
        tx_hash: w.tx_hash || w.txid,
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
                <tr
                  key={tx.id}
                  onClick={() => setSelectedTx(tx)}
                  className="hover:bg-gray-800/50 cursor-pointer transition-colors"
                >
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

      {/* Detail Modal */}
      {selectedTx && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-50 p-4">
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 max-w-md w-full shadow-2xl text-white">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-bold">
                {selectedTx.type === 'withdrawal' ? 'Withdrawal Details' : 'Deposit Details'}
              </h3>
              <span className="text-xs font-mono px-2 py-0.5 rounded bg-gray-800 text-gray-400 border border-gray-700">
                {selectedTx.chain}
              </span>
            </div>

            <div className="space-y-3 text-sm divide-y divide-gray-800/70">
              <div className="flex justify-between pt-2">
                <span className="text-gray-400">Receipt Address</span>
                <span className="font-mono text-xs text-right break-all max-w-[240px] text-gray-200">
                  {selectedTx.destination_address || 'N/A'}
                </span>
              </div>
              <div className="flex justify-between pt-2">
                <span className="text-gray-400">Time</span>
                <span className="text-gray-200 text-xs">
                  {new Date(selectedTx.created_at).toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between pt-2">
                <span className="text-gray-400">Amount</span>
                <span className="font-semibold font-mono text-white">
                  {selectedTx.amount} {selectedTx.asset}
                </span>
              </div>
              <div className="flex justify-between pt-2">
                <span className="text-gray-400">Coin</span>
                <span className="font-medium text-white">{selectedTx.asset}</span>
              </div>
              <div className="flex justify-between pt-2">
                <span className="text-gray-400">Gas Fee</span>
                <span className="font-mono text-gray-200">
                  {selectedTx.type === 'withdrawal'
                    ? `${selectedTx.network_fee !== undefined ? selectedTx.network_fee : '0.00'} ${selectedTx.asset}`
                    : 'Network Included'}
                </span>
              </div>
              <div className="flex justify-between pt-2">
                <span className="text-gray-400">Status</span>
                <span>{getStatusBadge(selectedTx.status)}</span>
              </div>
              {selectedTx.tx_hash && (
                <div className="flex justify-between pt-2">
                  <span className="text-gray-400">Tx Hash</span>
                  <span className="font-mono text-xs text-right break-all max-w-[220px] text-gray-400">
                    {selectedTx.tx_hash}
                  </span>
                </div>
              )}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                type="button"
                onClick={() => setSelectedTx(null)}
                className="w-full py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-lg font-medium transition-colors cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default TransactionHistory;
