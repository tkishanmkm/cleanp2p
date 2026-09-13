"use client";

import React from "react";
import { usePresenceStatus, resolveUserLastSeen } from "@/lib/presence";

export interface UserStatusProps {
  user?: any;
  lastActive?: string | Date | null;
  last_seen?: string | Date | null;
  showText?: boolean;
}

export function UserStatusIndicator({ user, lastActive, last_seen, showText = true }: UserStatusProps) {
  const target = user || last_seen || lastActive;
  const presence = usePresenceStatus(target, 15000);

  if (presence.isOnline) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
        </span>
        {showText && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">Online</span>}
      </div>
    );
  }

  const isRecent = presence.label.includes('m ago') || presence.label.includes('h ago');

  return (
    <div className="flex items-center gap-1.5">
      <span
        className={`h-2.5 w-2.5 rounded-full inline-block ${
          isRecent ? 'bg-amber-500' : 'bg-slate-400 dark:bg-slate-500'
        }`}
      />
      {showText && (
        <span
          className={`text-xs ${
            isRecent
              ? 'text-amber-600 dark:text-amber-400 font-medium'
              : 'text-muted-foreground'
          }`}
        >
          {presence.label}
        </span>
      )}
    </div>
  );
}

export default UserStatusIndicator;

