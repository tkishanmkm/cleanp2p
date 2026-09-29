export type NamePrivacy = 'full_name' | 'partial_name' | 'hide_name';

export interface UserDataInput {
  profile_username?: string | null;
  username?: string | null;
  full_name?: string | null;
  name_privacy?: NamePrivacy | string | null;
  is_online?: boolean | null;
  last_seen?: string | null;
  [key: string]: any;
}

export type ProfileData = UserDataInput;
export type UserPrivacyProfile = UserDataInput;

/**
 * RULE A: Platform-Wide Handle Extractor.
 * Always prefers profile_username, strips leading @, and falls back cleanly to @trader.
 */
export function getPublicHandle(user?: UserDataInput | { username?: string | null } | string | null): string {
  if (!user) return '@trader';

  let raw: string | null = null;

  if (typeof user === 'string') {
    raw = user;
  } else if (typeof user === 'object') {
    // Strictly prioritize profile_username
    raw = (user as UserDataInput).profile_username || user.username || null;
  }

  if (!raw || raw.trim() === '') return '@trader';

  const clean = raw.trim().startsWith('@') ? raw.trim().slice(1) : raw.trim();
  return `@${clean}`;
}

/**
 * RULE B: Exclusively for Trade Chat Info ("i" Icon) Modal.
 * Evaluates `name_privacy` to return Full Name, Initial + Last Name, or @username.
 */
export function getTradeChatDisplayName(user?: UserDataInput | null): string {
  if (!user) return 'Trader';

  const { full_name, profile_username, username, name_privacy } = user;
  const trimmedFullName = full_name?.trim() || '';
  const fallbackHandle = getPublicHandle(user);

  if (!trimmedFullName || name_privacy === 'hide_name') {
    return fallbackHandle;
  }

  if (name_privacy === 'full_name') {
    return trimmedFullName;
  }

  if (name_privacy === 'partial_name') {
    const parts = trimmedFullName.split(/\s+/).filter(Boolean);
    if (parts.length === 0) return fallbackHandle;
    const initial = `${parts[0].charAt(0).toUpperCase()}.`;
    const lastName = parts.length > 1 ? parts.slice(1).join(' ') : '';
    return lastName ? `${initial} ${lastName}` : initial;
  }

  return fallbackHandle;
}

/**
 * Determines if user is online based on last_seen within 2 minutes.
 */
export function isUserOnline(isOnline?: boolean | null, lastSeen?: string | null): boolean {
  if (lastSeen) {
    const diffMs = Date.now() - new Date(lastSeen).getTime();
    if (!isNaN(diffMs) && diffMs >= 0) {
      return Math.floor(diffMs / (1000 * 60)) <= 2;
    }
  }
  return Boolean(isOnline);
}

/**
 * Formatting Last Seen Text Helper for presence badges & trader cards.
 * User is marked "Online" if last_seen is within the last 2 minutes;
 * otherwise displays exact last_seen relative timestamp.
 */
export function getUserStatusText(isOnline?: boolean | null, lastSeen?: string | null): string {
  if (!lastSeen) {
    return isOnline ? 'Online' : 'Offline';
  }

  const diffMs = Date.now() - new Date(lastSeen).getTime();
  if (isNaN(diffMs) || diffMs < 0) {
    return isOnline ? 'Online' : 'Offline';
  }

  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins <= 2) return 'Online';
  if (diffMins < 60) return `Last seen ${diffMins}m ago`;
  if (diffHours < 24) return `Last seen ${diffHours}h ago`;
  return `Last seen ${diffDays}d ago`;
}

/**
 * Safe Array Parser for Postgres text[] / jsonb payment_methods column
 */
export function parsePaymentMethods(methods: unknown): string[] {
  if (Array.isArray(methods)) return methods;
  if (typeof methods === 'string') {
    try {
      const parsed = JSON.parse(methods);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      if (methods.includes(',')) {
        return methods.split(',').map((s) => s.trim()).filter(Boolean);
      }
      return [methods];
    }
  }
  return ['Bank Transfer'];
}

/**
 * Currency Symbol Formatting Helper
 */
export function formatCurrencyValue(amount: number, fiatSymbol?: string | null): string {
  const symbol = (fiatSymbol || 'USD').toUpperCase();
  const symbolMap: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
    INR: '₹',
    AED: 'AED ',
    CAD: 'CA$',
    AUD: 'AU$',
    JPY: '¥',
    CHF: 'CHF ',
    SGD: 'SG$',
    NGN: '₦',
    KES: 'KSh ',
    BRL: 'R$',
  };
  const prefix = symbolMap[symbol] || `${symbol} `;
  const locale = symbol === 'INR' ? 'en-IN' : 'en-US';
  return `${prefix}${Number(amount || 0).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export interface VerificationState {
  isVerified: boolean;
  isPending: boolean;
  isRejected: boolean;
  tier: 1 | 2;
  tierLabel: string;
  statusLabel: string;
}

/**
 * CANONICAL IDENTITY VERIFICATION HELPER
 * Normalizes user verification / KYC state across all UI surfaces and profile views.
 */
export function getIdentityVerificationState(profile?: any): VerificationState {
  if (!profile) {
    return {
      isVerified: false,
      isPending: false,
      isRejected: false,
      tier: 1,
      tierLabel: 'Tier 1 ($1,000 USD Limit)',
      statusLabel: 'Unverified',
    };
  }

  const rawStatus = String(profile.kyc_status || profile.id_status || profile.verification_status || '').toLowerCase().trim();
  const rawTier = Number(profile.verification_tier) || (String(profile.verification_tier).toUpperCase() === 'TIER_2' ? 2 : 1);

  const isVerified = Boolean(
    profile.is_verified === true ||
    profile.id_verified === true ||
    profile.is_id_verified === true ||
    ['approved', 'verified'].includes(rawStatus) ||
    rawTier === 2
  );

  const isPending = !isVerified && ['pending', 'submitted', 'in_review'].includes(rawStatus);
  const isRejected = !isVerified && ['rejected', 'declined', 'permanently_rejected'].includes(rawStatus);

  return {
    isVerified,
    isPending,
    isRejected,
    tier: isVerified ? 2 : 1,
    tierLabel: isVerified ? 'Tier 2 (Verified - No Limits)' : 'Tier 1 ($1,000 USD Limit)',
    statusLabel: isVerified ? 'Verified' : isPending ? 'In Review' : isRejected ? 'Declined' : 'Unverified',
  };
}
