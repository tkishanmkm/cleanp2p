"use client";

import React from "react";
import { usePresenceStatus } from "@/lib/presence";
import { useI18n } from "@/context/i18n-context";

export interface UserStatusProps {
  user?: any;
  lastActive?: string | Date | null;
  last_seen?: string | Date | null;
  showText?: boolean;
}

export function UserStatusIndicator({ user, lastActive, last_seen, showText = true }: UserStatusProps) {
  const { t } = useI18n();
  const target = user || last_seen || lastActive;
  const presence = usePresenceStatus(target, 15000);
  const presenceLabel = presence.isOnline
    ? t('p2pAdCard.online')
    : presence.label === 'Offline'
      ? t('p2pAdCard.offline')
      : (() => {
          const match = presence.label.match(/^Last seen (\d+)(m|h|d) ago$/);
          if (!match) return presence.label;
          const key = match[2] === 'm' ? 'lastSeenMinutes' : match[2] === 'h' ? 'lastSeenHours' : 'lastSeenDays';
          return t('p2pAdCard.' + key).replace('{count}', match[1]);
        })();

  if (presence.isOnline) {
    return (
      <div className="flex items-center gap-1.5">
        <span className="relative flex h-2.5 w-2.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
        </span>
        {showText && <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">{t('p2pAdCard.online')}</span>}
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
          {presenceLabel}
        </span>
      )}
    </div>
  );
}

export default UserStatusIndicator;

