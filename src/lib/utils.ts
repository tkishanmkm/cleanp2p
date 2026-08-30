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
