import 'server-only';

import { createAdminClient } from '@/lib/supabase/server';

export interface AdminTwoFactorRateLimit {
  allowed: boolean;
  remainingAttempts: number;
  retryAfterSeconds: number;
}

type RpcRateLimitResult = {
  allowed?: unknown;
  remaining_attempts?: unknown;
  retry_after_seconds?: unknown;
};

function normalizeResult(data: unknown): AdminTwoFactorRateLimit {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Admin 2FA rate-limit service returned an invalid response.');
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
    throw new Error('Admin 2FA rate-limit service returned an invalid response.');
  }

  return {
    allowed: value.allowed,
    remainingAttempts: Number(value.remaining_attempts),
    retryAfterSeconds: Number(value.retry_after_seconds),
  };
}

function assertAdminId(adminId: string): void {
  if (
    typeof adminId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(adminId)
  ) {
    throw new Error('A valid administrator ID is required for 2FA rate limiting.');
  }
}

/**
 * Database-backed, atomic administrator 2FA throttling.
 *
 * Keeping attempt state in Postgres means the lock survives application
 * restarts and applies consistently across every running web instance.
 * A database failure is propagated to the caller so the challenge route
 * can fail closed instead of silently bypassing brute-force protection.
 */
export async function checkAdmin2FARateLimit(adminId: string): Promise<AdminTwoFactorRateLimit> {
  assertAdminId(adminId);
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('check_admin_2fa_rate_limit', {
    p_admin_id: adminId,
  });
  if (error) {
    console.error('[Admin 2FA] Rate-limit check failed:', error.code || 'unknown');
    throw new Error('Administrator 2FA protection is temporarily unavailable.');
  }
  return normalizeResult(data);
}

export async function resetAdmin2FAFailures(adminId: string): Promise<void> {
  assertAdminId(adminId);
  const supabase = createAdminClient();
  const { data, error } = await supabase.rpc('reset_admin_2fa_rate_limit', {
    p_admin_id: adminId,
  });
  if (error || data !== true) {
    console.error('[Admin 2FA] Could not reset persistent rate limit:', error?.code || null);
    throw new Error('Administrator 2FA protection could not be reset.');
  }
}
