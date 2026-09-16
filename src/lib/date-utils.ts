// lib/date-utils.ts

/**
 * Standard platform-wide UTC/GMT Date Formatting Utilities.
 * Ensures consistent GMT/UTC timestamps across all platform modules,
 * preventing discrepancy between client local device clock and official records.
 */

/**
 * Formats any timestamp as a standardized UTC string.
 * Example output: "03 Sep 2026, 14:30:15 UTC"
 */
export function formatUtcDateTime(dateInput?: string | number | Date | null): string {
  if (!dateInput) return '—';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '—';

    const day = String(d.getUTCDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getUTCMonth()];
    const year = d.getUTCFullYear();
    const hours = String(d.getUTCHours()).padStart(2, '0');
    const minutes = String(d.getUTCMinutes()).padStart(2, '0');
    const seconds = String(d.getUTCSeconds()).padStart(2, '0');

    return `${day} ${month} ${year}, ${hours}:${minutes}:${seconds} UTC`;
  } catch {
    return '—';
  }
}

/**
 * Formats a timestamp into a compact UTC string for tables and chat bubbles.
 * Example output: "03 Sep, 14:30 UTC"
 */
export function formatCompactUtc(dateInput?: string | number | Date | null): string {
  if (!dateInput) return '—';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '—';

    const day = String(d.getUTCDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getUTCMonth()];
    const hours = String(d.getUTCHours()).padStart(2, '0');
    const minutes = String(d.getUTCMinutes()).padStart(2, '0');

    return `${day} ${month}, ${hours}:${minutes} UTC`;
  } catch {
    return '—';
  }
}

/**
 * Standard RFC-2822 / HTTP UTC string (e.g. "Thu, 03 Sep 2026 14:30:15 GMT")
 */
export function toUtcString(dateInput?: string | number | Date | null): string {
  if (!dateInput) return '—';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '—';
    return d.toUTCString();
  } catch {
    return '—';
  }
}

/**
 * Current timestamp in ISO UTC string
 */
export function getNowUtcIso(): string {
  return new Date().toISOString();
}

/**
 * Retrieves the user's preferred timezone from client storage or defaults to UTC±00:00.
 */
export function getUserTimezonePreference(): string {
  if (typeof window === 'undefined') return 'UTC±00:00';
  try {
    const saved = localStorage.getItem('p2p_preferred_timezone') || localStorage.getItem('paxones_timezone');
    if (saved) return saved;
    // Check if stored in user preferences
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('p2p_preferences_')) {
        const val = localStorage.getItem(key);
        if (val) {
          const parsed = JSON.parse(val);
          if (parsed.timezone) return parsed.timezone;
        }
      }
    }
  } catch {}
  return 'UTC±00:00';
}

/**
 * Saves the user's preferred timezone to client storage and broadcasts update.
 */
export function setUserTimezonePreference(tz: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem('p2p_preferred_timezone', tz);
    localStorage.setItem('paxones_timezone', tz);
    window.dispatchEvent(new CustomEvent('paxones:timezone-changed', { detail: tz }));
  } catch {}
}

/**
 * Parses a UTC offset string (e.g., "UTC+05:30", "UTC-04:00", "UTC±00:00", "UTC+08:00")
 * and returns the offset in minutes.
 */
export function parseUtcOffsetMinutes(tzString?: string | null): number {
  if (!tzString) return 0;
  const match = tzString.match(/UTC([+-±])(\d{1,2})(?::(\d{2}))?/i);
  if (!match) return 0;
  const sign = match[1];
  if (sign === '±') return 0;
  const hours = parseInt(match[2], 10) || 0;
  const minutes = parseInt(match[3] || '0', 10) || 0;
  const total = hours * 60 + minutes;
  return sign === '-' ? -total : total;
}

/**
 * Formats any UTC timestamp according to the user's selected timezone preference.
 * Underlying database records stay 100% pure UTC ISO strings.
 * Example: "16 Sep 2026, 17:30:15 (UTC+05:30)" or compact "16 Sep, 17:30 (UTC+05:30)"
 */
export function formatUserDateTime(
  dateInput?: string | number | Date | null,
  customTz?: string | null,
  compact: boolean = false
): string {
  if (!dateInput) return '—';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '—';

    const tz = customTz || getUserTimezonePreference();
    const offsetMinutes = parseUtcOffsetMinutes(tz);

    // Apply offset to UTC time
    const adjustedTime = new Date(d.getTime() + offsetMinutes * 60 * 1000);

    const day = String(adjustedTime.getUTCDate()).padStart(2, '0');
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[adjustedTime.getUTCMonth()];
    const year = adjustedTime.getUTCFullYear();
    const hours = String(adjustedTime.getUTCHours()).padStart(2, '0');
    const minutes = String(adjustedTime.getUTCMinutes()).padStart(2, '0');
    const seconds = String(adjustedTime.getUTCSeconds()).padStart(2, '0');

    const tzTag = tz.startsWith('UTC') ? tz.split(' ')[0] : 'UTC';

    if (compact) {
      return `${day} ${month}, ${hours}:${minutes} (${tzTag})`;
    }
    return `${day} ${month} ${year}, ${hours}:${minutes}:${seconds} (${tzTag})`;
  } catch {
    return '—';
  }
}

