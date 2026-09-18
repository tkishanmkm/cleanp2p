import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Safely converts a Firestore Timestamp, ISO string, or other date representation to a JavaScript Date object.
 * Returns null if the input is invalid.
 */
export function toDate(timestamp: any): Date | null {
  if (!timestamp) {
    return null;
  }
  // Firestore Timestamp object
  if (typeof timestamp.toDate === 'function') {
    return timestamp.toDate();
  }
  // ISO string or other date string/number
  const d = new Date(timestamp);
  // Check if the created date is valid
  if (isNaN(d.getTime())) {
    return null;
  }
  return d;
}

// Username Regex Pattern: 5 to 25 characters, lowercase letters, numbers, periods (.), and underscores (_)
export const USERNAME_REGEX = /^[a-z0-9._]{5,25}$/;

/**
 * Dynamic URL helper ensuring local testing stays on localhost while production resolves to paxones.com
 */
export const getURL = () => {
  let url = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://paxones.com';
  return url.endsWith('/') ? url : `${url}/`;
};


export function isValidUsername(username: string): boolean {
  return USERNAME_REGEX.test(username);
}

/**
 * Plays a pleasant notification beep for trade events (initiate, release)
 */
export function playTradeBeep() {
  try {
    if (typeof window === 'undefined') return;
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15); // A5
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.5);
  } catch (e) {
    // Ignore autoplay or audio restrictions
  }
}

/**
 * Normalizes any string into a valid username format:
 * - Converts to lowercase
 * - Replaces spaces and invalid characters with underscores
 * - Truncates to 25 characters max
 */
export function sanitizeUsername(rawInput: string): string {
  if (!rawInput) return "user";
  
  const sanitized = rawInput
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "_")               // Replace spaces with underscore
    .replace(/[^a-z0-9._]/g, "")        // Remove any non-allowed characters
    .slice(0, 25);                      // Max 25 characters

  return sanitized || "user";
}

/**
 * Calculates age in full years from a date of birth string (e.g. YYYY-MM-DD) or Date.
 */
export function calculateAge(dobInput: string | Date | null | undefined): number {
  if (!dobInput) return 0;
  const birthDate = typeof dobInput === 'string' ? new Date(dobInput) : dobInput;
  if (isNaN(birthDate.getTime())) return 0;

  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

/**
 * Determines whether the user is at least 18 years old for platform child safety.
 */
export function isAtLeast18(dobInput: string | Date | null | undefined): boolean {
  return calculateAge(dobInput) >= 18;
}
