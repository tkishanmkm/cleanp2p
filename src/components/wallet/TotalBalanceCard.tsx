'use client';

import React from 'react';

export function TotalBalanceCard({ totalUsdValue }: { totalUsdValue: number }) {
  return (
    <div className="p-6 bg-slate-900 text-white rounded-xl shadow-md border border-slate-800">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-medium text-slate-400 uppercase tracking-wider">
          Total Available Value
        </h2>
        <span className="text-xs px-2 py-1 bg-green-500/10 text-green-400 rounded-full font-mono">
          Platform-Wide
        </span>
      </div>
      
      <div className="text-3xl font-bold font-mono text-white mb-2">
        ${totalUsdValue.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </div>
      
      <p className="text-xs text-slate-400 leading-relaxed">
        This amount consolidates all spendable balances across every asset and network supported on the platform into a single unified USD value.
      </p>
    </div>
  );
}

export default TotalBalanceCard;
