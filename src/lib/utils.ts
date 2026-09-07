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

export function isValidUsername(username: string): boolean {
  return USERNAME_REGEX.test(username);
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
