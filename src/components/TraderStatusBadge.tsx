"use client";

import React from 'react';

export default function TraderStatusBadge({ presence, lastActive }: { presence?: string; lastActive?: string | Date | null }) {
  let status = presence;
  if (!status && lastActive) {
    const now = Date.now();
    const d = typeof lastActive === 'string' ? new Date(lastActive).getTime() : lastActive instanceof Date ? lastActive.getTime() : 0;
    if (d > 0) {
      const diffMinutes = Math.max(0, Math.floor((now - d) / (1000 * 60)));
      if (diffMinutes < 5) status = 'Online';
      else if (diffMinutes < 60) status = `${diffMinutes}m ago`;
      else {
        const diffHours = Math.floor(diffMinutes / 60);
        if (diffHours < 24) status = `${diffHours}h ago`;
        else status = 'Offline';
      }
    }
  }
  if (!status) status = 'Offline';

  const isOnline = status === 'Online';
  const isRecent = status.includes('m ago') || status.includes('h ago');

  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold">
      <span
        className={`h-2 w-2 rounded-full ${
          isOnline
            ? 'bg-emerald-500 animate-pulse shadow-sm shadow-emerald-500/50'
            : isRecent
            ? 'bg-amber-500'
            : 'bg-slate-400 dark:bg-slate-500'
        }`}
      />
      <span
        className={`${
          isOnline
            ? 'text-emerald-600 dark:text-emerald-400 font-bold'
            : isRecent
            ? 'text-amber-600 dark:text-amber-400 font-medium'
            : 'text-slate-500 dark:text-slate-400'
        }`}
      >
        {status}
      </span>
    </div>
  );
}

export { TraderStatusBadge };
