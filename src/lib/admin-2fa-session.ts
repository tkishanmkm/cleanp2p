import crypto from 'crypto';
import { NextResponse } from 'next/server';

export const ADMIN_2FA_COOKIE_NAME = 'pax_admin_2fa_session';
export const ADMIN_2FA_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60; // 12 hours

/**
 * Retrieves the dedicated 256-bit server key for admin 2FA session signing.
 */
function getAdminSessionKey(): Buffer {
  const rawKey = process.env.ADMIN_2FA_ENCRYPTION_KEY;
  if (!rawKey || typeof rawKey !== 'string' || rawKey.trim() === '') {
    throw new Error(
      'Server configuration error: Dedicated ADMIN_2FA_ENCRYPTION_KEY environment variable is not configured.'
    );
  }

  const cleanKey = rawKey.trim();
  if (/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
    return Buffer.from(cleanKey, 'hex');
  } else if (cleanKey.length === 32) {
    return Buffer.from(cleanKey, 'utf8');
  } else {
    return Buffer.from(cleanKey, 'base64');
  }
}

/**
 * Creates a cryptographically signed 2FA completion session token.
 * Bound to adminId, issue timestamp, expiration, and optional security version.
 */
export function createAdmin2FASessionToken(
  adminId: string,
  securityVersion?: string | null
): string {
  if (!adminId) throw new Error('adminId is required to issue 2FA session token');

  const verifiedAt = Date.now();
  const exp = verifiedAt + ADMIN_2FA_SESSION_MAX_AGE_SECONDS * 1000;
  const versionTag = securityVersion ? String(securityVersion).trim() : 'v0';

  const payloadString = `v1:session:${adminId}:${verifiedAt}:${exp}:${versionTag}`;
  const key = getAdminSessionKey();
  const hmac = crypto.createHmac('sha256', key).update(payloadString).digest('hex');

  return `${payloadString}:${hmac}`;
}

/**
 * Validates a signed 2FA session token.
 * Returns valid: true if signature matches, token has not expired, and adminId matches.
 */
export function verifyAdmin2FASessionToken(
  token: string | null | undefined,
  expectedAdminId: string,
  currentSecurityVersion?: string | null
): { valid: boolean; reason?: string } {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'Missing 2FA session token' };
  }

  try {
    const parts = token.trim().split(':');
    // Format: v1 : session : adminId : verifiedAt : exp : versionTag : hmac
    if (parts.length !== 7 || parts[0] !== 'v1' || parts[1] !== 'session') {
      return { valid: false, reason: 'Invalid token structure' };
    }

    const [, , adminId, verifiedAtStr, expStr, versionTag, signature] = parts;

    // 1. Check admin ID match
    if (adminId !== expectedAdminId) {
      return { valid: false, reason: 'Admin ID mismatch' };
    }

    // 2. Check expiration
    const exp = parseInt(expStr, 10);
    if (isNaN(exp) || Date.now() > exp) {
      return { valid: false, reason: '2FA session token has expired' };
    }

    // 3. Check security version if present
    if (currentSecurityVersion && versionTag !== 'v0') {
      const cleanCurrentVersion = String(currentSecurityVersion).trim();
      if (versionTag !== cleanCurrentVersion) {
        return { valid: false, reason: '2FA credentials rotated since token issue' };
      }
    }

    // 4. Verify cryptographic signature
    const payloadString = `v1:session:${adminId}:${verifiedAtStr}:${expStr}:${versionTag}`;
    const key = getAdminSessionKey();
    const expectedHmac = crypto.createHmac('sha256', key).update(payloadString).digest('hex');

    if (!crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expectedHmac, 'hex'))) {
      return { valid: false, reason: 'Invalid token signature' };
    }

    return { valid: true };
  } catch (err: any) {
    return { valid: false, reason: `Verification error: ${err.message}` };
  }
}

/**
 * Sets the HttpOnly, Secure, SameSite=Lax 2FA session cookie on a NextResponse.
 */
export function setAdmin2FACookie(response: NextResponse, token: string) {
  const isProd = process.env.NODE_ENV === 'production';
  response.cookies.set({
    name: ADMIN_2FA_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: ADMIN_2FA_SESSION_MAX_AGE_SECONDS,
  });
}

/**
 * Clears the 2FA session cookie from a NextResponse.
 */
export function clearAdmin2FACookie(response: NextResponse) {
  response.cookies.set({
    name: ADMIN_2FA_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
