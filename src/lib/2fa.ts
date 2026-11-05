import 'server-only';

import speakeasy from 'speakeasy';
import { decryptUserTOTPSecret, ensureUserTOTPSecretEncrypted } from '@/lib/user-2fa-crypto';
import { ensureAdminTOTPSecretEncrypted } from '@/lib/admin-2fa-crypto';
import { checkUser2FARateLimit, resetUser2FAFailures, type UserTwoFactorRateLimit } from '@/lib/user-2fa-rate-limit';

export type SensitiveAction = 'withdrawal' | 'transfer' | 'trade_release' | 'disable_2fa' | 'password_change' | 'security_question';

export function verify2FAOTP(userSecret: string | null | undefined, otpToken: string | null | undefined, is2FAEnabled: boolean): boolean {
  if (!is2FAEnabled) {
    return true;
  }
  if (!userSecret || typeof otpToken !== 'string' || !/^\d{6}$/.test(otpToken.trim())) {
    return false;
  }
  try {
    const cleanToken = otpToken.trim();
    const decryptedBase32Secret = decryptUserTOTPSecret(String(userSecret).trim());
    if (!decryptedBase32Secret) {
      return false;
    }

    const verified = speakeasy.totp.verify({
      secret: decryptedBase32Secret,
      encoding: 'base32',
      token: cleanToken,
      window: 1,
    });
    return Boolean(verified);
  } catch (err) {
    console.error('2FA verification error:', err instanceof Error ? err.name : 'UnknownError');
    return false;
  }
}

export type SensitiveTotpResult =
  | { ok: true }
  | { ok: false; status: 401 | 429 | 503; error: string; retryAfterSeconds?: number };

/**
 * Shared persistent TOTP gate for money movement and escrow-release endpoints.
 * It records an attempt before evaluating the token and resets the counter only
 * after a valid code. No OTP or secret is ever written to logs/audit details.
 */
export async function verifyUserTotpForSensitiveAction(
  adminClient: any,
  userId: string,
  secret: string | null | undefined,
  token: unknown,
  action: Extract<SensitiveAction, 'withdrawal' | 'transfer' | 'trade_release'>
): Promise<SensitiveTotpResult> {
  let rateLimit: UserTwoFactorRateLimit;
  try {
    rateLimit = await checkUser2FARateLimit(userId);
  } catch {
    return { ok: false, status: 503, error: 'Two-factor protection is temporarily unavailable.' };
  }

  if (!rateLimit.allowed) {
    const { error: auditError } = await adminClient.from('user_security_audit_logs').insert({
      user_id: userId,
      action: '2fa_sensitive_action_rate_limited',
      details: { action, retryAfterSeconds: rateLimit.retryAfterSeconds },
    });
    if (auditError) {
      return { ok: false, status: 503, error: 'The rate-limited security attempt could not be audited.' };
    }
    return {
      ok: false,
      status: 429,
      error: 'Too many two-factor attempts. Please try again later.',
      retryAfterSeconds: rateLimit.retryAfterSeconds,
    };
  }

  let encryptedSecret = '';
  try {
    const { data: currentProfile, error: profileError } = await adminClient
      .from('profiles')
      .select('totp_secret, two_factor_secret, admin_2fa_secret, role, is_admin, is_admin_account, admin_2fa_enabled, is_2fa_enabled, is_mfa_enabled, two_factor_enabled')
      .eq('id', userId)
      .maybeSingle();

    if (profileError || !currentProfile) {
      return { ok: false, status: 503, error: 'Account authenticator state could not be verified.' };
    }

    const currentCandidates = [currentProfile.totp_secret, currentProfile.two_factor_secret]
      .filter((value): value is string => typeof value === 'string' && value.length > 0);
    const suppliedSecret = typeof secret === 'string' ? secret.trim() : '';
    if (suppliedSecret && !currentCandidates.includes(suppliedSecret)) {
      return { ok: false, status: 503, error: 'Account authenticator changed. Please retry the action.' };
    }

    encryptedSecret = await ensureUserTOTPSecretEncrypted(
      adminClient,
      userId,
      currentProfile,
    );
    if (!encryptedSecret) {
      return { ok: false, status: 503, error: 'Account authenticator is unavailable.' };
    }

    // If this is also an administrator account, split any legacy shared TOTP
    // value into the dedicated user/admin ciphertext columns before verifying.
    if (
      currentProfile.is_admin ||
      currentProfile.is_admin_account ||
      String(currentProfile.role || '').toLowerCase() === 'admin' ||
      currentProfile.admin_2fa_enabled
    ) {
      await ensureAdminTOTPSecretEncrypted(adminClient, userId, { ...currentProfile, totp_secret: encryptedSecret });
    }
  } catch {
    return { ok: false, status: 503, error: 'Account authenticator could not be securely encrypted and verified.' };
  }

  const valid = typeof token === 'string' && /^\d{6}$/.test(token.trim())
    && verify2FAOTP(encryptedSecret, token.trim(), true);

  if (!valid) {
    const { error: auditError } = await adminClient.from('user_security_audit_logs').insert({
      user_id: userId,
      action: '2fa_sensitive_action_failed',
      details: { action, reason: typeof token === 'string' && /^\d{6}$/.test(token.trim()) ? 'invalid_code' : 'invalid_format' },
    });
    if (auditError) {
      return { ok: false, status: 503, error: 'The failed security attempt could not be audited.' };
    }
    return { ok: false, status: 401, error: 'Invalid authenticator code. Please check your authenticator app.' };
  }

  try {
    await resetUser2FAFailures(userId);
  } catch {
    return { ok: false, status: 503, error: 'Two-factor protection could not be reset securely.' };
  }

  return { ok: true };
}
