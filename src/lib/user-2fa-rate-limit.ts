/**
 * User 2FA In-Memory Rate Limiter
 * Enforces maximum 5 failed attempts per 15 minutes per user / identifier.
 */

interface UserRateLimitRecord {
  failures: number;
  firstFailureTime: number;
  lastFailureTime: number;
}

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes

// Runtime process memory store
const userFailureStore = new Map<string, UserRateLimitRecord>();

function cleanupStaleRecords() {
  const now = Date.now();
  for (const [key, record] of userFailureStore.entries()) {
    if (now - record.lastFailureTime > WINDOW_MS) {
      userFailureStore.delete(key);
    }
  }
}

/**
 * Checks if the given user key is rate-limited.
 */
export function checkUser2FARateLimit(key: string): {
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSeconds: number;
} {
  if (!key) return { allowed: true, remainingAttempts: MAX_FAILURES, retryAfterSeconds: 0 };

  cleanupStaleRecords();

  const now = Date.now();
  const record = userFailureStore.get(key);

  if (!record) {
    return { allowed: true, remainingAttempts: MAX_FAILURES, retryAfterSeconds: 0 };
  }

  // If window expired, reset
  if (now - record.firstFailureTime > WINDOW_MS) {
    userFailureStore.delete(key);
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
export function recordUser2FAFailure(key: string): {
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSeconds: number;
} {
  if (!key) return { allowed: true, remainingAttempts: MAX_FAILURES, retryAfterSeconds: 0 };

  const now = Date.now();
  let record = userFailureStore.get(key);

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

  userFailureStore.set(key, record);

  return checkUser2FARateLimit(key);
}

/**
 * Resets failures on successful 2FA verification.
 */
export function resetUser2FAFailures(key: string) {
  if (key) {
    userFailureStore.delete(key);
  }
}
