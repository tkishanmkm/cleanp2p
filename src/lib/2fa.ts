import speakeasy from 'speakeasy';

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
    const cleanSecret = String(userSecret).trim();
    if (cleanToken.length < 4 || cleanToken.length > 8) {
      return false;
    }

    // Speakeasy verification with +/- 2 window (±60 seconds drift allowance)
    const verified = speakeasy.totp.verify({
      secret: cleanSecret,
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
