import { verifySync } from 'otplib';

// Support both otplib direct export and authenticator interface wrapper
export const otplib = {
  verifySync,
  authenticator: {
    check: (token: string, secret: string): boolean => {
      try {
        const cleanToken = String(token || '').replace(/[\s-]+/g, '').trim();
        const cleanSecret = String(secret || '').trim();
        if (!cleanToken || !cleanSecret) return false;

        const res = verifySync({ token: cleanToken, secret: cleanSecret });
        return typeof res === 'boolean' ? res : Boolean(res?.valid);
      } catch {
        return false;
      }
    },
  },
};

export type SensitiveAction = 'withdrawal' | 'transfer' | 'trade_release' | 'disable_2fa';

export function verify2FAOTP(userSecret: string | null, otpToken: string, is2FAEnabled: boolean): boolean {
  // If 2FA is enabled, a valid TOTP token is mandatory
  if (is2FAEnabled) {
    if (!userSecret || !otpToken) return false;
    try {
      return otplib.authenticator.check(otpToken, userSecret);
    } catch (err) {
      return false;
    }
  }
  return true; // Pass if 2FA is not enabled on account (or handle mandatory enforcement in route)
}
