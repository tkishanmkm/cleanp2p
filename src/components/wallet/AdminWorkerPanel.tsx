'use client';

import React, { useState } from 'react';

export function AdminWorkerPanel() {
  const [loadingWorker, setLoadingWorker] = useState<'deposit' | 'withdrawal' | null>(null);
  const [outputLog, setOutputLog] = useState<string | null>(null);

  const triggerWorker = async (type: 'deposit' | 'withdrawal') => {
    setLoadingWorker(type);
    setOutputLog(null);

    const endpoint = `/api/workers/${type}-worker`;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await res.json();
      setOutputLog(`[${type.toUpperCase()}] status: ${res.status}\n` + JSON.stringify(data, null, 2));
    } catch (err: any) {
      setOutputLog(`[${type.toUpperCase()}] error: ${err.message}`);
    } finally {
      setLoadingWorker(null);
    }
  };

  return (
    <div className="w-full rounded-xl bg-gray-950 p-5 text-white border border-gray-800 shadow-md">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse"></span>
          Dev Controls: Worker Triggers
        </h4>
        <span className="text-xs text-gray-500 font-mono">Environment: Preview</span>
      </div>

      <div className="flex flex-wrap gap-3 mb-3">
        <button
          onClick={() => triggerWorker('deposit')}
          disabled={loadingWorker !== null}
          className="rounded-md bg-emerald-950 px-4 py-2 text-xs font-semibold text-emerald-300 border border-emerald-800 hover:bg-emerald-900 transition-colors disabled:opacity-50"
        >
          {loadingWorker === 'deposit' ? 'Scanning...' : 'Run Deposit Scanner Worker'}
        </button>

        <button
          onClick={() => triggerWorker('withdrawal')}
          disabled={loadingWorker !== null}
          className="rounded-md bg-blue-950 px-4 py-2 text-xs font-semibold text-blue-300 border border-blue-800 hover:bg-blue-900 transition-colors disabled:opacity-50"
        >
          {loadingWorker === 'withdrawal' ? 'Processing...' : 'Run Withdrawal Worker'}
        </button>
      </div>

      {outputLog && (
        <pre className="mt-3 overflow-x-auto rounded bg-gray-900 p-3 text-xs font-mono text-gray-300 border border-gray-800 max-h-40">
          {outputLog}
        </pre>
      )}
    </div>
  );
}
