import { createAdminClient } from '@/lib/supabase/admin';
import {
  verifyAdminTOTPToken,
  hashRecoveryPassword,
  logAdminSecurityAudit,
} from '@/lib/admin-security';

export interface Admin2FAVerificationResult {
  isEnforced: boolean;
  isValid: boolean;
  error?: string;
}

export async function assertAdmin2FAEnforced(
  adminId: string,
  totpCode?: string,
  recoveryPassword?: string,
  actionName = 'SENSITIVE_ADMIN_ACTION'
): Promise<Admin2FAVerificationResult> {
  const supabase = createAdminClient();
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email, admin_2fa_enabled, is_2fa_enabled, admin_2fa_secret, two_factor_secret, admin_2fa_recovery_hash')
    .eq('id', adminId)
    .single();

  if (!profile) {
    return { isEnforced: false, isValid: false, error: 'Admin profile not found' };
  }

  const is2FAEnabled = Boolean(profile.admin_2fa_enabled || profile.is_2fa_enabled);
  if (!is2FAEnabled) {
    // 2FA is not enabled for this admin; enforcement passes
    return { isEnforced: false, isValid: true };
  }

  const secret = profile.admin_2fa_secret || profile.two_factor_secret;
  const adminEmail = profile.email || 'admin';

  let isValid = false;
  let methodUsed = '';

  if (totpCode && secret) {
    isValid = verifyAdminTOTPToken(secret, String(totpCode));
    if (isValid) methodUsed = 'totp';
  }

  if (!isValid && recoveryPassword && profile.admin_2fa_recovery_hash) {
    const candidateHash = hashRecoveryPassword(String(recoveryPassword));
    if (candidateHash === profile.admin_2fa_recovery_hash) {
      isValid = true;
      methodUsed = 'recovery_password';
    }
  }

  if (!isValid) {
    await logAdminSecurityAudit({
      adminId,
      adminEmail,
      action: `${actionName}_2FA_FAILED`,
      details: { reason: totpCode || recoveryPassword ? 'Invalid 2FA code or recovery password' : 'Missing 2FA verification code' },
    });

    return {
      isEnforced: true,
      isValid: false,
      error: totpCode || recoveryPassword
        ? 'Invalid 6-digit 2FA authenticator code or recovery password.'
        : 'Admin 2FA verification is required for this action. Please provide a valid 6-digit 2FA code.',
    };
  }

  await logAdminSecurityAudit({
    adminId,
    adminEmail,
    action: `${actionName}_2FA_PASSED`,
    details: { method: methodUsed },
  });

  return { isEnforced: true, isValid: true };
}
