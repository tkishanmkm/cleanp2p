import speakeasy from 'speakeasy';
import { decryptUserTOTPSecret } from '@/lib/user-2fa-crypto';

export type SensitiveAction = 'withdrawal' | 'transfer' | 'trade_release' | 'disable_2fa' | 'password_change' | 'security_question';

export function verify2FAOTP(userSecret: string | null | undefined, otpToken: string | null | undefined, is2FAEnabled: boolean): boolean {
  if (!is2FAEnabled) {
    return true;
  }
  if (!userSecret || !otpToken) {
    return false;
  }
  try {
    const cleanToken = String(otpToken).replace(/[\s-]+/g, '').trim();
    if (cleanToken.length < 4 || cleanToken.length > 8) {
      return false;
    }

    // Decrypt if AES-256-GCM encrypted, or use plaintext if legacy Base32
    const decryptedBase32Secret = decryptUserTOTPSecret(String(userSecret).trim());
    if (!decryptedBase32Secret) {
      return false;
    }

    // Speakeasy verification with +/- 2 window (±60 seconds drift allowance)
    const verified = speakeasy.totp.verify({
      secret: decryptedBase32Secret,
      encoding: 'base32',
      token: cleanToken,
      window: 2,
    });
    return Boolean(verified);
  } catch (err) {
    console.error('2FA verification error:', err);
    return false;
  }
}
