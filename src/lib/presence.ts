'use client';

import { useState, useEffect } from 'react';

/**
 * Resolves a unified timestamp from various possible profile/user properties.
 * Always prioritizes `last_seen` (the active heartbeat timestamp).
 */
export function resolveUserLastSeen(userOrTimestamp: any): string | Date | null | undefined {
  if (!userOrTimestamp) return null;
  if (typeof userOrTimestamp === 'string' || userOrTimestamp instanceof Date) {
    return userOrTimestamp;
  }
  if (typeof userOrTimestamp === 'object') {
    return (
      userOrTimestamp.last_seen ||
      userOrTimestamp.last_seen_at ||
      userOrTimestamp.last_active ||
      userOrTimestamp.lastActive ||
      userOrTimestamp.updated_at ||
      userOrTimestamp.updatedAt ||
      null
    );
  }
  return null;
}

// Calculates online status with a 120-second threshold
export function getPresenceStatus(lastSeen: string | Date | null | undefined) {
  const resolved = resolveUserLastSeen(lastSeen);
  if (!resolved) return { isOnline: false, label: 'Offline' };
  
  const lastSeenDate = typeof resolved === 'string' ? new Date(resolved) : resolved instanceof Date ? resolved : new Date(resolved);
  if (isNaN(lastSeenDate.getTime())) return { isOnline: false, label: 'Offline' };
  
  const diffInSeconds = Math.max(0, Math.floor((Date.now() - lastSeenDate.getTime()) / 1000));

  if (diffInSeconds < 120) {
    return { isOnline: true, label: 'Online' };
  }

  if (diffInSeconds < 3600) {
    const mins = Math.max(1, Math.floor(diffInSeconds / 60));
    return { isOnline: false, label: `Last seen ${mins}m ago` };
  }

  if (diffInSeconds < 86400) {
    const hours = Math.floor(diffInSeconds / 3600);
    return { isOnline: false, label: `Last seen ${hours}h ago` };
  }

  const days = Math.floor(diffInSeconds / 86400);
  return { isOnline: false, label: `Last seen ${days}d ago` };
}

/**
 * Custom React hook for live real-time presence with auto-ticker.
 * Ticks every `intervalMs` (default 15s) so timestamps update dynamically.
 */
export function usePresenceStatus(userOrLastSeen: any, intervalMs: number = 15000) {
  const resolvedTimestamp = resolveUserLastSeen(userOrLastSeen);
  const [presence, setPresence] = useState(() => getPresenceStatus(resolvedTimestamp));

  useEffect(() => {
    const latest = resolveUserLastSeen(userOrLastSeen);
    setPresence(getPresenceStatus(latest));

    const interval = setInterval(() => {
      setPresence(getPresenceStatus(resolveUserLastSeen(userOrLastSeen)));
    }, intervalMs);

    return () => clearInterval(interval);
  }, [userOrLastSeen, intervalMs]);

  return presence;
}

// Relative join date formatter
export function formatJoinedDate(createdAt: string | Date | null | undefined): string {
  if (!createdAt) return 'Joined recently';
  
  const created = new Date(createdAt);
  if (isNaN(created.getTime())) return 'Joined recently';

  const diffInDays = Math.floor((Date.now() - created.getTime()) / (1000 * 3600 * 24));

  if (diffInDays < 1) return 'Joined today';
  if (diffInDays === 1) return 'Joined 1 day ago';
  if (diffInDays < 30) return `Joined ${diffInDays} days ago`;
  
  const diffInMonths = Math.floor(diffInDays / 30);
  if (diffInMonths < 12) {
    return `Joined ${diffInMonths} month${diffInMonths > 1 ? 's' : ''} ago`;
  }

  const diffInYears = Math.floor(diffInDays / 365);
  return `Joined ${diffInYears} year${diffInYears > 1 ? 's' : ''} ago`;
}

