import 'server-only';

import { createAdminClient } from '@/lib/supabase/server';
import speakeasy from 'speakeasy';
import crypto from 'crypto';
import {
  encryptAdminTOTPSecret,
  decryptAdminTOTPSecret,
  ensureAdminTOTPSecretEncrypted,
  hashRecoveryPassword,
  verifyRecoveryPasswordHash,
} from '@/lib/admin-2fa-crypto';

export {
  encryptAdminTOTPSecret,
  decryptAdminTOTPSecret,
  hashRecoveryPassword,
  verifyRecoveryPasswordHash,
};

export interface AdminSecurityState {
  adminId: string;
  adminEmail: string;
  themePreference: 'light' | 'dark' | 'system';
  is2FAEnabled: boolean;
  hasSecret: boolean;
  hasRecoveryPassword: boolean;
  recoveryUpdatedAt?: string | null;
}

export function generateRecoveryPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let result = 'pax-rec';
  for (let i = 0; i < 3; i++) {
    result += '-';
    for (let j = 0; j < 4; j++) {
      result += chars.charAt(crypto.randomInt(chars.length));
    }
  }
  return result;
}

export function verifyAdminTOTPToken(encryptedOrPlainSecret: string, token: string): boolean {
  if (!encryptedOrPlainSecret || !token) return false;
  const cleanToken = token.replace(/[\s-]+/g, '').trim();
  if (cleanToken.length < 6 || cleanToken.length > 8) return false;

  // Decrypt secret if AES-256-GCM encrypted
  const decryptedBase32Secret = decryptAdminTOTPSecret(encryptedOrPlainSecret);
  if (!decryptedBase32Secret) return false;

  try {
    return speakeasy.totp.verify({
      secret: decryptedBase32Secret.trim(),
      encoding: 'base32',
      token: cleanToken,
      window: 2, // ±60s clock drift
    });
  } catch (err) {
    console.error('TOTP Verification Error:', err);
    return false;
  }
}

export async function logAdminSecurityAudit(params: {
  adminId: string;
  adminEmail?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, any>;
  ipAddress?: string;
}): Promise<boolean> {
  try {
    const supabase = createAdminClient();
    const details = {
      ...(params.details || {}),
      target_type: params.targetType || 'admin_security',
      // The production admin_audit_logs schema stores request context in JSONB.
      // Do not insert target_type/ip_address as columns that do not exist.
      ip_address: params.ipAddress || 'server-observed',
    };
    const { error } = await supabase.from('admin_audit_logs').insert({
      admin_id: params.adminId,
      admin_email: params.adminEmail || null,
      action: params.action,
      target_id: params.targetId || params.adminId,
      details,
      created_at: new Date().toISOString(),
    });
    if (error) {
      console.error('Failed to write admin security audit log:', error.code || 'database_error');
      return false;
    }
    return true;
  } catch (err) {
    console.error('Failed to write admin security audit log:', err);
    return false;
  }
}

export async function getAdminSecurityState(adminId: string): Promise<AdminSecurityState | null> {
  const supabase = createAdminClient();
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, email, admin_theme_preference, admin_2fa_enabled, is_2fa_enabled, is_mfa_enabled, two_factor_enabled, totp_secret, role, is_admin, is_admin_account, admin_2fa_secret, two_factor_secret, admin_2fa_recovery_hash, admin_2fa_recovery_updated_at')
    .eq('id', adminId)
    .single();

  if (error || !profile) return null;

  let encryptedSecret = '';
  try {
    encryptedSecret = await ensureAdminTOTPSecretEncrypted(supabase, adminId, profile);
  } catch {
    console.error('[Admin 2FA] TOTP secret encryption migration failed; refusing to report an unverified state.');
    return null;
  }

  if ((profile.admin_2fa_enabled || profile.is_2fa_enabled) && !encryptedSecret) {
    console.error('[Admin 2FA] Enabled account has no usable encrypted TOTP secret.');
    return null;
  }

  const is2FAEnabled = Boolean(profile.admin_2fa_enabled || profile.is_2fa_enabled);

  return {
    adminId: profile.id,
    adminEmail: profile.email || '',
    themePreference: (profile.admin_theme_preference as any) || 'system',
    is2FAEnabled,
    hasSecret: Boolean(encryptedSecret),
    hasRecoveryPassword: Boolean(profile.admin_2fa_recovery_hash),
    recoveryUpdatedAt: profile.admin_2fa_recovery_updated_at || null,
  };
}
