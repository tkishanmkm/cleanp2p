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
