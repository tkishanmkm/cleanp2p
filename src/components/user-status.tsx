"use client";

import React from "react";

export interface UserStatusProps {
  lastActive?: string | Date | null;
  showText?: boolean;
}

export function UserStatusIndicator({ lastActive, showText = true }: UserStatusProps) {
  if (!lastActive) {
    return (
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-400 inline-block" />
        {showText && <span className="text-xs text-muted-foreground">Offline</span>}
      </div>
    );
  }

  const now = new Date().getTime();
  const lastActiveDate = typeof lastActive === 'string' ? new Date(lastActive) : lastActive instanceof Date ? lastActive : new Date();
  const lastActiveTime = isNaN(lastActiveDate.getTime()) ? 0 : lastActiveDate.getTime();

  if (lastActiveTime === 0) {
    return (
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-slate-400 inline-block" />
        {showText && <span className="text-xs text-muted-foreground">Offline</span>}
      </div>
    );
  }

  const diffInMinutes = Math.max(0, Math.floor((now - lastActiveTime) / (1000 * 60)));
  const diffInHours = Math.floor(diffInMinutes / 60);

  // 1. Online (Active within last 5 minutes) -> Green Dot
  if (diffInMinutes < 5) {
    return (
      <div className="flex items-center gap-2">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
        </span>
        {showText && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Online</span>}
      </div>
    );
  }

  // 2. Away / Last Seen (Active within last 24 hours) -> Yellow Dot
  if (diffInHours < 24) {
    const timeText = diffInHours < 1 ? `${diffInMinutes}m ago` : `${diffInHours}h ago`;
    return (
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-full bg-amber-500 inline-block" />
        {showText && <span className="text-xs text-amber-600 dark:text-amber-400">Last seen {timeText}</span>}
      </div>
    );
  }

  // 3. Offline (> 24 hours) -> Grey Dot
  return (
    <div className="flex items-center gap-2">
      <span className="h-2.5 w-2.5 rounded-full bg-slate-400 inline-block" />
      {showText && <span className="text-xs text-muted-foreground">Offline</span>}
    </div>
  );
}

export default UserStatusIndicator;
