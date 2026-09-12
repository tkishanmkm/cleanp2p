/**
 * Utility functions for user presence and relative time formatting
 */

export function getDisplayUsername(ad: any): string {
  const profile = Array.isArray(ad?.profiles) ? ad.profiles[0] : ad?.profiles || ad?.user || ad?.creator;
  
  if (profile?.username && typeof profile.username === 'string' && profile.username.trim() !== '') {
    return profile.username.trim();
  }

  if (profile?.full_name && typeof profile.full_name === 'string' && profile.full_name.trim() !== '') {
    return profile.full_name.trim();
  }

  if (ad?.user_display_name && typeof ad.user_display_name === 'string' && ad.user_display_name.trim() !== '') {
    return ad.user_display_name.trim();
  }

  const fallbackId = profile?.id || ad?.user_id;
  return fallbackId ? `user_${String(fallbackId).substring(0, 7)}` : 'Trader';
}

/**
 * Checks if a user is online (active within 120 seconds) or returns precise relative last seen when offline.
 */
export function getUserPresenceStatus(lastSeen?: string | Date | null, isOnlineFlag?: boolean): {
  isOnline: boolean;
  statusText: string;
  dotColor: string;
} {
  if (!lastSeen) {
    if (isOnlineFlag === true) {
      return {
        isOnline: true,
        statusText: 'Online',
        dotColor: 'bg-emerald-500',
      };
    }
    return {
      isOnline: false,
      statusText: 'Offline',
      dotColor: 'bg-slate-400 dark:bg-slate-500',
    };
  }

  const lastSeenDate = new Date(lastSeen);
  if (isNaN(lastSeenDate.getTime())) {
    return {
      isOnline: isOnlineFlag === true,
      statusText: isOnlineFlag ? 'Online' : 'Offline',
      dotColor: isOnlineFlag ? 'bg-emerald-500' : 'bg-slate-400 dark:bg-slate-500',
    };
  }

  const diffMs = Date.now() - lastSeenDate.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  // Active within 120 seconds (2 minutes) is considered Online
  if (diffSeconds <= 120) {
    return {
      isOnline: true,
      statusText: 'Online',
      dotColor: 'bg-emerald-500',
    };
  }

  if (diffMinutes < 60) {
    const mins = Math.max(1, diffMinutes);
    return {
      isOnline: false,
      statusText: `${mins} min${mins === 1 ? '' : 's'} ago`,
      dotColor: 'bg-slate-400 dark:bg-slate-500',
    };
  }

  if (diffHours < 24) {
    return {
      isOnline: false,
      statusText: `${diffHours} hr${diffHours === 1 ? '' : 's'} ago`,
      dotColor: 'bg-slate-400 dark:bg-slate-500',
    };
  }

  if (diffDays === 1) {
    return {
      isOnline: false,
      statusText: 'Yesterday',
      dotColor: 'bg-slate-400 dark:bg-slate-500',
    };
  }

  return {
    isOnline: false,
    statusText: `${diffDays} days ago`,
    dotColor: 'bg-slate-400 dark:bg-slate-500',
  };
}

export function checkIsOnline(lastSeen?: string | Date | null, isOnlineFlag?: boolean): boolean {
  return getUserPresenceStatus(lastSeen, isOnlineFlag).isOnline;
}

/**
 * Human-readable relative time formatting for registration date (e.g., "1 month ago", "3 days ago")
 * Never displays exact date or timestamp.
 */
export function formatJoinedDate(createdAt?: string | Date | null): string {
  if (!createdAt) return 'recently';

  const created = new Date(createdAt);
  if (isNaN(created.getTime())) return 'recently';

  const diffMs = Date.now() - created.getTime();
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffMonths = Math.floor(diffDays / 30);
  const diffYears = Math.floor(diffDays / 365);

  if (diffMinutes < 1) return 'today';
  if (diffMinutes < 60) return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  if (diffMonths < 12) return `${diffMonths} month${diffMonths === 1 ? '' : 's'} ago`;
  return `${diffYears} year${diffYears === 1 ? '' : 's'} ago`;
}

export const isUserOnline = checkIsOnline;
