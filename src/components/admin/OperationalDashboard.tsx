'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase/client';
import AlertsBanner from './AlertsBanner';

interface ReconciliationData {
  db_liability: number;
  onchain_balance: number;
  discrepancy: number;
  is_balanced: boolean;
  gas_snapshot: Array<{
    network: string;
    nativeBalance: string;
    isSufficient: boolean;
    symbol: string;
  }>;
  created_at: string;
}

interface PendingWithdrawal {
  id: string;
  user_id: string;
  network: string;
  to_address: string;
  amount: number;
  fee: number;
  asset_symbol: string;
  created_at: string;
}

export default function OperationalDashboard({ authToken }: { authToken?: string }) {
  const [loading, setLoading] = useState(true);
  const [reconciliation, setReconciliation] = useState<ReconciliationData | null>(null);
  const [approvals, setApprovals] = useState<PendingWithdrawal[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [resolvedToken, setResolvedToken] = useState<string>(authToken || '');

  // Obtain access token if not passed directly as a prop
  useEffect(() => {
    if (authToken) {
      setResolvedToken(authToken);
      return;
    }

    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.access_token) {
        setResolvedToken(data.session.access_token);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.access_token) {
        setResolvedToken(session.access_token);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, [authToken]);

  const fetchData = useCallback(async () => {
    if (!resolvedToken) return;
    try {
      setLoading(true);
      const res = await fetch('/api/admin/dashboard/overview', {
        headers: { Authorization: `Bearer ${resolvedToken}` },
      });
      const json = await res.json();
      if (json.success && json.data) {
        setReconciliation(json.data.reconciliation);
        setApprovals(json.data.pendingApprovals || []);
      }
    } catch (err) {
      console.error('Failed fetching admin metrics:', err);
    } finally {
      setLoading(false);
    }
  }, [resolvedToken]);

  useEffect(() => {
    if (resolvedToken) {
      fetchData();
      const interval = setInterval(fetchData, 30000); // Auto-refresh every 30s
      return () => clearInterval(interval);
    }
  }, [resolvedToken, fetchData]);

  const handleReviewAction = async (withdrawalId: string, action: 'APPROVE' | 'REJECT') => {
    if (!resolvedToken) {
      alert('Authentication required.');
      return;
    }

    try {
      setProcessingId(withdrawalId);
      const res = await fetch('/api/admin/withdrawals/review', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${resolvedToken}`,
        },
        body: JSON.stringify({
          withdrawalId,
          action,
          rejectionReason: action === 'REJECT' ? 'Rejected via Admin Ops Console' : undefined,
        }),
      });

      const json = await res.json();
      if (json.success) {
        setApprovals((prev) => prev.filter((item) => item.id !== withdrawalId));
      } else {
        alert(`Action failed: ${json.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`);
    } finally {
      setProcessingId(null);
    }
  };

  if (loading && !reconciliation) {
    return (
      <div id="ops-dashboard-loading" className="p-6 text-gray-400">
        Loading Operational Metrics...
      </div>
    );
  }

  return (
    <div id="operational-dashboard-container" className="p-6 space-y-8 bg-slate-900 text-white min-h-screen">
      <div className="flex flex-wrap items-center justify-between border-b border-slate-800 pb-4 gap-4">
        <h1 id="ops-dashboard-title" className="text-2xl font-bold">
          Platform Operations & Solvency Control
        </h1>
        <button
          id="ops-refresh-btn"
          onClick={fetchData}
          disabled={loading}
          className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded border border-slate-700 transition disabled:opacity-50"
        >
          {loading ? 'Refreshing...' : 'Refresh Metrics'}
        </button>
      </div>

      {/* Active System Alerts Banner */}
      {resolvedToken && <AlertsBanner authToken={resolvedToken} />}

      {/* 1. Solvency Banner */}
      {reconciliation && (
        <div
          id="ops-solvency-banner"
          className={`p-6 rounded-lg border ${
            reconciliation.is_balanced
              ? 'bg-emerald-950/40 border-emerald-500/50'
              : 'bg-rose-950/40 border-rose-500/50'
          }`}
        >
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <span className="text-xs uppercase tracking-wider font-semibold text-gray-400">
                Solvency Verification Status
              </span>
              <h2 id="ops-solvency-heading" className="text-xl font-bold mt-1">
                {reconciliation.is_balanced ? 'Fully Collateralized ✅' : 'Under-Collateralized Warning ⚠️'}
              </h2>
            </div>
            <div className="text-right">
              <span className="text-xs text-gray-400">Variance / Discrepancy</span>
              <p
                id="ops-discrepancy-val"
                className={`text-xl font-mono font-bold ${
                  reconciliation.discrepancy >= 0 ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                {reconciliation.discrepancy >= 0 ? '+' : ''}
                {Number(reconciliation.discrepancy).toFixed(2)} USDT
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6 pt-4 border-t border-slate-800/80">
            <div>
              <span className="text-xs text-gray-400">Total User Liabilities (DB)</span>
              <p id="ops-liability-val" className="text-lg font-mono font-semibold">
                {Number(reconciliation.db_liability).toFixed(2)} USDT
              </p>
            </div>
            <div>
              <span className="text-xs text-gray-400">Hot Wallet On-Chain Reserves</span>
              <p id="ops-onchain-val" className="text-lg font-mono font-semibold">
                {Number(reconciliation.onchain_balance).toFixed(2)} USDT
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 2. Hot Wallet Gas Reserves */}
      {reconciliation?.gas_snapshot && reconciliation.gas_snapshot.length > 0 && (
        <div id="ops-gas-section">
          <h3 className="text-lg font-semibold mb-4 text-slate-200">Hot Wallet Gas Token Reserves</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {reconciliation.gas_snapshot.map((gas) => (
              <div
                key={gas.network}
                id={`ops-gas-card-${gas.network}`}
                className={`p-4 rounded-lg border bg-slate-800/50 ${
                  gas.isSufficient ? 'border-slate-700' : 'border-amber-500/80 bg-amber-950/20'
                }`}
              >
                <div className="flex justify-between items-center">
                  <span className="font-bold text-slate-300">{gas.network}</span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded font-medium ${
                      gas.isSufficient ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'
                    }`}
                  >
                    {gas.isSufficient ? 'Sufficient' : 'Refill Required'}
                  </span>
                </div>
                <p className="text-2xl font-mono font-bold mt-2">
                  {parseFloat(gas.nativeBalance || '0').toFixed(4)}{' '}
                  <span className="text-sm text-gray-400">{gas.symbol}</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 3. Pending High-Value Approval Queue */}
      <div id="ops-approvals-section">
        <h3 className="text-lg font-semibold mb-4 text-slate-200">
          High-Value Withdrawal Approval Queue ({approvals.length})
        </h3>
        {approvals.length === 0 ? (
          <div
            id="ops-no-approvals"
            className="p-8 rounded-lg border border-slate-800 text-center text-slate-500 bg-slate-800/20"
          >
            No pending high-value withdrawals requiring review.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-800">
            <table id="ops-approvals-table" className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-800/80 text-slate-400 text-xs uppercase tracking-wider">
                  <th className="p-3">Network</th>
                  <th className="p-3">Destination Address</th>
                  <th className="p-3">Amount</th>
                  <th className="p-3">Fee</th>
                  <th className="p-3">Submitted At</th>
                  <th className="p-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800 font-mono text-sm">
                {approvals.map((item) => (
                  <tr key={item.id} id={`approval-row-${item.id}`} className="hover:bg-slate-800/40">
                    <td className="p-3 font-semibold text-emerald-400">{item.network}</td>
                    <td className="p-3 text-slate-300">
                      {item.to_address
                        ? `${item.to_address.slice(0, 6)}...${item.to_address.slice(-6)}`
                        : 'N/A'}
                    </td>
                    <td className="p-3 font-bold">{Number(item.amount).toFixed(2)} USDT</td>
                    <td className="p-3 text-slate-400">{Number(item.fee).toFixed(2)} USDT</td>
                    <td className="p-3 text-slate-400 text-xs font-sans">
                      {new Date(item.created_at).toLocaleString()}
                    </td>
                    <td className="p-3 text-right space-x-2">
                      <button
                        id={`approve-btn-${item.id}`}
                        onClick={() => handleReviewAction(item.id, 'APPROVE')}
                        disabled={processingId === item.id}
                        className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-xs font-sans font-semibold disabled:opacity-50 transition"
                      >
                        {processingId === item.id ? 'Processing...' : 'Approve'}
                      </button>
                      <button
                        id={`reject-btn-${item.id}`}
                        onClick={() => handleReviewAction(item.id, 'REJECT')}
                        disabled={processingId === item.id}
                        className="px-3 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded text-xs font-sans font-semibold disabled:opacity-50 transition"
                      >
                        {processingId === item.id ? 'Processing...' : 'Reject'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
