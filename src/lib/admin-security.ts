import { createAdminClient } from '@/lib/supabase/server';
import speakeasy from 'speakeasy';
import {
  encryptAdminTOTPSecret,
  decryptAdminTOTPSecret,
  isEncryptedAdminTOTPSecret,
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
      result += chars.charAt(Math.floor(Math.random() * chars.length));
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
}) {
  try {
    const supabase = createAdminClient();
    await supabase.from('admin_audit_logs').insert({
      admin_id: params.adminId,
      admin_email: params.adminEmail || null,
      action: params.action,
      target_type: params.targetType || 'admin_security',
      target_id: params.targetId || params.adminId,
      details: params.details || {},
      ip_address: params.ipAddress || 'client',
      created_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Failed to write admin security audit log:', err);
  }
}

export async function getAdminSecurityState(adminId: string): Promise<AdminSecurityState | null> {
  const supabase = createAdminClient();
  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, email, admin_theme_preference, admin_2fa_enabled, is_2fa_enabled, admin_2fa_secret, two_factor_secret, admin_2fa_recovery_hash, admin_2fa_recovery_updated_at')
    .eq('id', adminId)
    .single();

  if (error || !profile) return null;

  const rawSecret = profile.admin_2fa_secret || profile.two_factor_secret;

  // Auto-migration: if legacy plaintext secret exists, encrypt and persist
  if (rawSecret && !isEncryptedAdminTOTPSecret(rawSecret)) {
    try {
      const encryptedSecret = encryptAdminTOTPSecret(rawSecret);
      await supabase
        .from('profiles')
        .update({
          admin_2fa_secret: encryptedSecret,
          two_factor_secret: encryptedSecret,
        })
        .eq('id', adminId);
    } catch (migErr) {
      console.warn('Transparent TOTP secret encryption auto-migration notice:', migErr);
    }
  }

  const is2FAEnabled = Boolean(profile.admin_2fa_enabled || profile.is_2fa_enabled);

  return {
    adminId: profile.id,
    adminEmail: profile.email || '',
    themePreference: (profile.admin_theme_preference as any) || 'system',
    is2FAEnabled,
    hasSecret: Boolean(rawSecret),
    hasRecoveryPassword: Boolean(profile.admin_2fa_recovery_hash),
    recoveryUpdatedAt: profile.admin_2fa_recovery_updated_at || null,
  };
}
