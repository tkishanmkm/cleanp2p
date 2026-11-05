import 'server-only';

import { createAdminClient } from '@/lib/supabase/server';

export interface UserTwoFactorRateLimit {
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSeconds: number;
}

type RpcRateLimitResult = {
  allowed?: unknown;
  remaining_attempts?: unknown;
  retry_after_seconds?: unknown;
};

function normalizeResult(data: unknown): UserTwoFactorRateLimit {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('User 2FA rate-limit service returned an invalid response.');
  }
  const value = data as RpcRateLimitResult;
  if (
    typeof value.allowed !== 'boolean' ||
    !Number.isInteger(value.remaining_attempts) ||
    !Number.isInteger(value.retry_after_seconds) ||
    Number(value.remaining_attempts) < 0 ||
    Number(value.remaining_attempts) > 5 ||
    Number(value.retry_after_seconds) < 0 ||
    Number(value.retry_after_seconds) > 900
  ) {
    throw new Error('User 2FA rate-limit service returned an invalid response.');
  }
  return {
    allowed: value.allowed,
    remainingAttempts: Number(value.remaining_attempts),
    retryAfterSeconds: Number(value.retry_after_seconds),
  };
}

function assertUserId(userId: string): void {
  if (
    typeof userId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)
  ) {
    throw new Error('A valid user ID is required for 2FA rate limiting.');
  }
}

/** Persistent rate limiting applies across instances and survives restarts. */
export async function checkUser2FARateLimit(userId: string): Promise<UserTwoFactorRateLimit> {
  assertUserId(userId);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('check_user_2fa_rate_limit', { p_user_id: userId });
  if (error) {
    console.error('[User 2FA] Rate-limit check failed:', error.code || 'unknown');
    throw new Error('Two-factor protection is temporarily unavailable.');
  }
  return normalizeResult(data);
}

export async function resetUser2FAFailures(userId: string): Promise<void> {
  assertUserId(userId);
  const admin = createAdminClient();
  const { data, error } = await admin.rpc('reset_user_2fa_rate_limit', { p_user_id: userId });
  if (error || data !== true) {
    console.error('[User 2FA] Could not reset persistent rate limit:', error?.code || null);
    throw new Error('Two-factor protection could not be reset.');
  }
}
