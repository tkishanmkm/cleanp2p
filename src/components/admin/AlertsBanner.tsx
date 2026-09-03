'use client';

import React, { useEffect, useState, useCallback } from 'react';

interface SystemAlert {
  id: string;
  alert_type: string;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
  created_at: string;
}

export default function AlertsBanner({ authToken }: { authToken: string }) {
  const [alerts, setAlerts] = useState<SystemAlert[]>([]);

  const fetchAlerts = useCallback(async () => {
    if (!authToken) return;
    try {
      const res = await fetch('/api/admin/alerts', {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      const json = await res.json();
      if (json.success) setAlerts(json.alerts || []);
    } catch (err) {
      console.error('Failed to fetch system alerts:', err);
    }
  }, [authToken]);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 15000); // Check every 15s
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  const handleDismiss = async (alertId: string) => {
    if (!authToken) return;
    try {
      const res = await fetch('/api/admin/alerts', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ alertId }),
      });
      const json = await res.json();
      if (json.success) {
        setAlerts((prev) => prev.filter((a) => a.id !== alertId));
      }
    } catch (err) {
      console.error('Failed to dismiss alert:', err);
    }
  };

  if (alerts.length === 0) return null;

  return (
    <div id="admin-alerts-banner" className="space-y-3 mb-6">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400 flex items-center gap-2">
          <span>🔔</span> Active System Alerts ({alerts.length})
        </h3>
      </div>

      {alerts.map((alert) => (
        <div
          key={alert.id}
          id={`system-alert-${alert.id}`}
          className={`p-4 rounded-lg border flex items-start justify-between gap-4 transition-all ${
            alert.severity === 'CRITICAL'
              ? 'bg-rose-950/60 border-rose-500/80 text-rose-200'
              : 'bg-amber-950/60 border-amber-500/80 text-amber-200'
          }`}
        >
          <div>
            <div className="flex items-center gap-2">
              <span
                className={`text-xs px-2 py-0.5 rounded font-bold uppercase ${
                  alert.severity === 'CRITICAL' ? 'bg-rose-500 text-white' : 'bg-amber-500 text-black'
                }`}
              >
                {alert.severity}
              </span>
              <h4 className="font-bold text-sm text-white">{alert.title}</h4>
            </div>
            <p className="text-xs mt-1 text-slate-300 font-sans">{alert.message}</p>
            <span className="text-[10px] text-slate-400 font-mono mt-1 block">
              Logged at: {new Date(alert.created_at).toLocaleString()}
            </span>
          </div>

          <button
            id={`dismiss-alert-${alert.id}`}
            onClick={() => handleDismiss(alert.id)}
            className="text-xs px-2.5 py-1 bg-slate-800/80 hover:bg-slate-700 text-slate-200 rounded border border-slate-700 font-sans font-medium shrink-0 transition"
          >
            Dismiss
          </button>
        </div>
      ))}
    </div>
  );
}
