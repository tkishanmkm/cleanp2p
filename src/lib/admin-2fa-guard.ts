import 'server-only';

import { createAdminClient } from '@/lib/supabase/server';
import { verifyAdminTOTPToken, logAdminSecurityAudit } from '@/lib/admin-security';
import { ensureAdminTOTPSecretEncrypted } from '@/lib/admin-2fa-crypto';
import { checkAdmin2FARateLimit, resetAdmin2FAFailures } from '@/lib/admin-2fa-rate-limit';

export interface Admin2FAVerificationResult {
  isEnforced: boolean;
  isValid: boolean;
  error?: string;
}

/**
 * Reusable guard for sensitive admin actions.
 *
 * Generic privileged actions accept a fresh TOTP only. A recovery credential is
 * one-time and is accepted only by the dedicated recovery endpoint, where its
 * rotation/consumption and audit trail are handled explicitly.
 */
export async function assertAdmin2FAEnforced(
  adminId: string,
  totpCode?: string,
  recoveryPassword?: string,
  actionName = 'SENSITIVE_ADMIN_ACTION'
): Promise<Admin2FAVerificationResult> {
  const supabase = createAdminClient();
  const { data: profile, error: profileError } = await supabase
    .from('profiles')
    .select('id, email, role, is_admin, is_admin_account, is_banned, is_suspended, is_on_hold, status, account_status, admin_2fa_enabled, is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, admin_2fa_secret, two_factor_secret')
    .eq('id', adminId)
    .maybeSingle();

  if (profileError) {
    return { isEnforced: true, isValid: false, error: 'Administrator security state could not be verified.' };
  }
  if (!profile || (!profile.is_admin && !profile.is_admin_account && profile.role !== 'admin')) {
    return { isEnforced: true, isValid: false, error: 'Administrator access is required.' };
  }
  if (
    profile.is_banned || profile.is_suspended || profile.is_on_hold ||
    ['banned', 'suspended', 'on_hold', 'hold', 'deleted', 'deletion_pending'].includes(String(profile.status || '').toLowerCase()) ||
    ['banned', 'suspended', 'on_hold', 'hold', 'deleted', 'deletion_pending'].includes(String(profile.account_status || '').toLowerCase())
  ) {
    return { isEnforced: true, isValid: false, error: 'This administrator account is disabled.' };
  }

  const is2FAEnabled = Boolean(profile.admin_2fa_enabled || profile.is_2fa_enabled);
  if (!is2FAEnabled) {
    return { isEnforced: false, isValid: true };
  }

  const adminEmail = profile.email || 'admin';
  let limit;
  try {
    limit = await checkAdmin2FARateLimit(adminId);
  } catch {
    return { isEnforced: true, isValid: false, error: 'Administrator 2FA protection is temporarily unavailable.' };
  }
  if (!limit.allowed) {
    const auditSaved = await logAdminSecurityAudit({
      adminId,
      adminEmail,
      action: `${actionName}_2FA_RATE_LIMITED`,
      details: { retryAfterSeconds: limit.retryAfterSeconds },
      ipAddress: 'server-observed',
    });
    return {
      isEnforced: true,
      isValid: false,
      error: auditSaved
        ? `Too many 2FA attempts. Try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`
        : 'Administrator 2FA rate limit could not be securely audited.',
    };
  }

  if (recoveryPassword) {
    return {
      isEnforced: true,
      isValid: false,
      error: 'Recovery credentials are single-use and can only be used through the dedicated administrator recovery flow.',
    };
  }

  let encryptedSecret = '';
  try {
    encryptedSecret = await ensureAdminTOTPSecretEncrypted(supabase, adminId, profile);
  } catch {
    return { isEnforced: true, isValid: false, error: 'Administrator authenticator could not be securely encrypted and verified.' };
  }
  if (!encryptedSecret) {
    return { isEnforced: true, isValid: false, error: 'Administrator authenticator is unavailable.' };
  }

  const normalizedCode = typeof totpCode === 'string' ? totpCode.replace(/[\s-]+/g, '').trim() : '';
  const isValid = /^\d{6,8}$/.test(normalizedCode) && verifyAdminTOTPToken(encryptedSecret, normalizedCode);

  if (!isValid) {
    const remaining = limit;
    const auditSaved = await logAdminSecurityAudit({
      adminId,
      adminEmail,
      action: `${actionName}_2FA_FAILED`,
      details: { reason: 'Invalid or missing TOTP code', remainingAttempts: remaining.remainingAttempts },
      ipAddress: 'server-observed',
    });
    return {
      isEnforced: true,
      isValid: false,
      error: auditSaved
        ? 'A valid authenticator code is required for this action.'
        : 'Administrator 2FA failure could not be securely audited.',
    };
  }

  const auditSaved = await logAdminSecurityAudit({
    adminId,
    adminEmail,
    action: `${actionName}_2FA_PASSED`,
    details: { method: 'totp' },
    ipAddress: 'server-observed',
  });
  if (!auditSaved) {
    return { isEnforced: true, isValid: false, error: 'Administrator 2FA success could not be securely audited.' };
  }

  try {
    await resetAdmin2FAFailures(adminId);
  } catch {
    return { isEnforced: true, isValid: false, error: 'Administrator 2FA rate-limit state could not be reset.' };
  }

  return { isEnforced: true, isValid: true };
}
