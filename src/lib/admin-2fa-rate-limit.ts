/**
 * Admin 2FA In-Memory Rate Limiter
 * Enforces maximum 5 failed attempts per 15 minutes per administrator.
 */

interface RateLimitRecord {
  failures: number;
  firstFailureTime: number;
  lastFailureTime: number;
}

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Global map in Node.js runtime process
const failureStore = new Map<string, RateLimitRecord>();

/**
 * Periodically purge stale records
 */
function cleanupStaleRecords() {
  const now = Date.now();
  for (const [key, record] of failureStore.entries()) {
    if (now - record.lastFailureTime > WINDOW_MS) {
      failureStore.delete(key);
    }
  }
}

/**
 * Checks if the given admin is currently rate-limited from 2FA attempts.
 */
export function checkAdmin2FARateLimit(adminId: string): {
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSeconds: number;
} {
  if (!adminId) return { allowed: true, remainingAttempts: MAX_FAILURES, retryAfterSeconds: 0 };

  cleanupStaleRecords();

  const now = Date.now();
  const record = failureStore.get(adminId);

  if (!record) {
    return { allowed: true, remainingAttempts: MAX_FAILURES, retryAfterSeconds: 0 };
  }

  // If window expired, reset record
  if (now - record.firstFailureTime > WINDOW_MS) {
    failureStore.delete(adminId);
    return { allowed: true, remainingAttempts: MAX_FAILURES, retryAfterSeconds: 0 };
  }

  if (record.failures >= MAX_FAILURES) {
    const retryAfterMs = record.firstFailureTime + WINDOW_MS - now;
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    return {
      allowed: false,
      remainingAttempts: 0,
      retryAfterSeconds,
    };
  }

  return {
    allowed: true,
    remainingAttempts: Math.max(0, MAX_FAILURES - record.failures),
    retryAfterSeconds: 0,
  };
}

/**
 * Records a failed 2FA verification attempt.
 */
export function recordAdmin2FAFailure(adminId: string): {
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSeconds: number;
} {
  if (!adminId) return { allowed: true, remainingAttempts: MAX_FAILURES, retryAfterSeconds: 0 };

  const now = Date.now();
  let record = failureStore.get(adminId);

  if (!record || now - record.firstFailureTime > WINDOW_MS) {
    record = {
      failures: 1,
      firstFailureTime: now,
      lastFailureTime: now,
    };
  } else {
    record.failures += 1;
    record.lastFailureTime = now;
  }

  failureStore.set(adminId, record);

  return checkAdmin2FARateLimit(adminId);
}

/**
 * Resets failures on successful 2FA verification.
 */
export function resetAdmin2FAFailures(adminId: string) {
  if (adminId) {
    failureStore.delete(adminId);
  }
}
