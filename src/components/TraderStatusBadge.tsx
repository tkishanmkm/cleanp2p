"use client";

import React from "react";
import { usePresenceStatus, resolveUserLastSeen } from "@/lib/presence";

export interface TraderStatusBadgeProps {
  user?: any;
  presence?: string;
  lastActive?: string | Date | null;
  last_seen?: string | Date | null;
}

export default function TraderStatusBadge({ user, presence: customPresence, lastActive, last_seen }: TraderStatusBadgeProps) {
  const target = user || last_seen || lastActive;
  const statusInfo = usePresenceStatus(target, 15000);

  const status = customPresence || statusInfo.label;
  const isOnline = status === 'Online' || statusInfo.isOnline;
  const isRecent = status.includes('min') || status.includes('hr') || status.includes('m ago') || status.includes('h ago');

  return (
    <div className="flex items-center gap-1.5 text-xs font-semibold">
      <span
        className={`h-2 w-2 rounded-full ${
          isOnline
            ? 'bg-emerald-500 animate-pulse shadow-xs shadow-emerald-500/50'
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


