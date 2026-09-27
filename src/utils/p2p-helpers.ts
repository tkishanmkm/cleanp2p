// src/utils/p2p-helpers.ts

/**
 * Formats user online status:
 * - Online (if active within last 5 minutes)
 * - Last seen Xm ago / Xh ago (if within 24 hours)
 * - Offline (if inactive > 24 hours)
 */
export function formatOnlineStatus(lastSeenAt?: string | null): { text: string; isOnline: boolean } {
  if (!lastSeenAt) return { text: 'Offline', isOnline: false };
  
  const lastSeen = new Date(lastSeenAt);
  if (isNaN(lastSeen.getTime())) return { text: 'Offline', isOnline: false };

  const now = new Date();
  const diffInMinutes = Math.floor((now.getTime() - lastSeen.getTime()) / (1000 * 60));

  if (diffInMinutes < 5) {
    return { text: 'Online', isOnline: true };
  }
  if (diffInMinutes < 60) {
    return { text: `Last seen ${diffInMinutes}m ago`, isOnline: false };
  }
  
  const diffInHours = Math.floor(diffInMinutes / 60);
  if (diffInHours < 24) {
    return { text: `Last seen ${diffInHours}h ago`, isOnline: false };
  }

  return { text: 'Offline', isOnline: false };
}

/**
 * Calculates human-readable joined date
 */
export function formatJoinedDate(createdAt?: string | null): string {
  if (!createdAt) return 'Joined recently';
  const created = new Date(createdAt);
  if (isNaN(created.getTime())) return 'Joined recently';

  const now = new Date();
  const diffInDays = Math.floor((now.getTime() - created.getTime()) / (1000 * 3600 * 24));

  if (diffInDays < 1) return 'Joined today';
  if (diffInDays === 1) return 'Joined 1 day ago';
  if (diffInDays < 30) return `Joined ${diffInDays} days ago`;

  const diffInMonths = Math.floor(diffInDays / 30);
  if (diffInMonths === 1) return 'Joined 1 month ago';
  if (diffInMonths < 12) return `Joined ${diffInMonths} months ago`;

  const diffInYears = Math.floor(diffInMonths / 12);
  if (diffInYears === 1) return 'Joined 1 year ago';
  return `Joined ${diffInYears} years ago`;
}

/**
 * Safely resolves and normalizes ad trade direction (BUY / SELL) across payload variants.
 * Rules:
 * 1. Preserve explicit valid BUY/SELL trade_type if present.
 * 2. Otherwise derive from type.
 * 3. Otherwise derive from ad_type / side.
 * 4. Return null if no valid BUY/SELL direction can be resolved.
 */
export function resolveTradeType(payload: Record<string, any>): 'BUY' | 'SELL' | null {
  if (!payload || typeof payload !== 'object') return null;

  const candidates = [
    payload.trade_type,
    payload.tradeType,
    payload.type,
    payload.ad_type,
    payload.adType,
    payload.side,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) {
      const val = candidate.trim().toUpperCase();
      if (val === 'BUY' || val === 'ONLINE_BUY' || val.includes('BUY')) {
        return 'BUY';
      }
      if (val === 'SELL' || val === 'ONLINE_SELL' || val.includes('SELL')) {
        return 'SELL';
      }
    }
  }

  return null;
}
