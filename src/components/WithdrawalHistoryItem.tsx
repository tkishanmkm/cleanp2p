'use client';

import React, { useState } from 'react';

export interface WithdrawalRecord {
  id: string;
  currency: string;
  amount: number;
  estimated_gas_fee: number;
  to_address: string;
  status: 'processing' | 'pending_approval' | 'queued' | 'completed' | 'failed';
  created_at: string;
}

export function WithdrawalHistoryItem({ item }: { item: WithdrawalRecord }) {
  const [showDetail, setShowDetail] = useState(false);

  // Normalize user-facing status label (hides internal admin/queue mechanics)
  const getPublicStatus = (status: string) => {
    switch (status) {
      case 'completed': return { label: 'Completed', style: 'bg-emerald-100 text-emerald-800' };
      case 'failed': return { label: 'Failed', style: 'bg-rose-100 text-rose-800' };
      default: return { label: 'Withdrawal Pending', style: 'bg-amber-100 text-amber-800' };
    }
  };

  const statusInfo = getPublicStatus(item.status);

  return (
    <>
      {/* Minimal History Row */}
      <div 
        id={`withdrawal-item-${item.id}`}
        onClick={() => setShowDetail(true)}
        className="flex items-center justify-between p-3 border-b hover:bg-slate-50 cursor-pointer transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-700">
            {item.currency}
          </div>
          <div>
            <p className="font-semibold text-sm text-slate-900">{item.amount} {item.currency}</p>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusInfo.style}`}>
              {statusInfo.label}
            </span>
          </div>
        </div>
        <span className="text-slate-400 text-sm">→</span>
      </div>

      {/* Detailed View Modal on Tap */}
      {showDetail && (
        <div id={`withdrawal-modal-${item.id}`} className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg p-5 max-w-md w-full shadow-xl">
            <h3 className="text-lg font-bold text-slate-900 mb-4">Withdrawal Details</h3>
            
            <div className="space-y-3 text-sm">
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">Receipt Address</span>
                <span className="text-slate-900 font-mono text-xs break-all text-right max-w-[220px]">{item.to_address}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">Time</span>
                <span className="text-slate-900 text-xs">{new Date(item.created_at).toLocaleString()}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">Amount</span>
                <span className="text-slate-900 font-semibold">{item.amount} {item.currency}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">Coin</span>
                <span className="text-slate-900 font-medium">{item.currency}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">Gas Fee</span>
                <span className="text-slate-900 font-mono">{item.estimated_gas_fee} {item.currency}</span>
              </div>
              <div className="flex justify-between border-b pb-2">
                <span className="text-slate-500">Status</span>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusInfo.style}`}>
                  {statusInfo.label}
                </span>
              </div>
            </div>

            <button
              id={`btn-close-modal-${item.id}`}
              onClick={() => setShowDetail(false)}
              className="mt-5 w-full py-2 bg-slate-900 text-white rounded-md font-medium hover:bg-slate-800 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default WithdrawalHistoryItem;
