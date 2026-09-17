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
 * or region name (e.g., "India", "IST", "Asia/Kolkata") and returns the offset in minutes.
 */
export function parseUtcOffsetMinutes(tzString?: string | null): number {
  if (!tzString) return 0;
  const str = String(tzString).trim();

  // Check for common regional strings like India
  if (
    str.toLowerCase().includes('india') ||
    str.toUpperCase().includes('IST') ||
    str.toLowerCase().includes('kolkata') ||
    str.toLowerCase().includes('calcutta')
  ) {
    return 330; // UTC+05:30 = 330 minutes
  }

  const match = str.match(/UTC([+-±])(\d{1,2})(?::(\d{2}))?/i);
  if (!match) return 0;
  const sign = match[1];
  if (sign === '±') return 0;
  const hours = parseInt(match[2], 10) || 0;
  const minutes = parseInt(match[3] || '0', 10) || 0;
  const total = hours * 60 + minutes;
  return sign === '-' ? -total : total;
}

/**
 * Returns a human-friendly display tag for the timezone (e.g., "IST (UTC+05:30)", "UTC±00:00")
 */
export function getFriendlyTzTag(tzString?: string | null): string {
  const tz = tzString || getUserTimezonePreference();
  if (
    tz.toLowerCase().includes('india') ||
    tz.toUpperCase().includes('IST') ||
    tz.toLowerCase().includes('kolkata') ||
    tz === 'UTC+05:30'
  ) {
    return 'IST (UTC+05:30)';
  }
  const match = tz.match(/UTC[+-±]\d{1,2}(?::\d{2})?/i);
  return match ? match[0] : 'GMT';
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

    const tzTag = getFriendlyTzTag(tz);

    if (compact) {
      return `${day} ${month}, ${hours}:${minutes} (${tzTag})`;
    }
    return `${day} ${month} ${year}, ${hours}:${minutes}:${seconds} (${tzTag})`;
  } catch {
    return '—';
  }
}

/**
 * Formats date strictly using the clean Arial style in trade details
 * Example: "09/17/26, 9:30 pm (IST)"
 */
export function formatUserDateTimeArial(
  dateInput?: string | number | Date | null,
  customTz?: string | null
): string {
  if (!dateInput) return 'N/A';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return 'N/A';

    const tz = customTz || getUserTimezonePreference();
    const offsetMinutes = parseUtcOffsetMinutes(tz);

    const adjusted = new Date(d.getTime() + offsetMinutes * 60 * 1000);
    const month = String(adjusted.getUTCMonth() + 1).padStart(2, '0');
    const day = String(adjusted.getUTCDate()).padStart(2, '0');
    const year = String(adjusted.getUTCFullYear()).slice(-2);

    let hours = adjusted.getUTCHours();
    const minutes = String(adjusted.getUTCMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    hours = hours % 12;
    hours = hours ? hours : 12;

    const tzTag = getFriendlyTzTag(tz);
    return `${month}/${day}/${year}, ${hours}:${minutes} ${ampm} (${tzTag})`;
  } catch {
    return 'N/A';
  }
}

/**
 * Formats time for chat bubbles according to user timezone preference
 * Example: "09:30 PM (IST)" or "21:30 (IST)"
 */
export function formatUserChatTime(
  dateInput?: string | number | Date | null,
  customTz?: string | null
): string {
  if (!dateInput) return '';
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return '';

    const tz = customTz || getUserTimezonePreference();
    const offsetMinutes = parseUtcOffsetMinutes(tz);

    const adjusted = new Date(d.getTime() + offsetMinutes * 60 * 1000);
    let hours = adjusted.getUTCHours();
    const minutes = String(adjusted.getUTCMinutes()).padStart(2, '0');
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12;
    hours = hours ? hours : 12;

    const tzTag = getFriendlyTzTag(tz);
    return `${hours}:${minutes} ${ampm} (${tzTag})`;
  } catch {
    return '';
  }
}

