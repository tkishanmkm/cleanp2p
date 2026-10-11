import crypto from 'crypto';
import { NextResponse } from 'next/server';

export const USER_2FA_COOKIE_NAME = 'pax_user_2fa_session';
export const USER_2FA_SESSION_MAX_AGE_SECONDS = 12 * 60 * 60; // 12 hours

/**
 * Retrieves and validates the dedicated 256-bit server key for user 2FA session signing.
 * Strictly fails closed if USER_2FA_ENCRYPTION_KEY is missing or invalid.
 */
function getUserSessionKey(): Buffer {
  const rawKey = process.env.USER_2FA_ENCRYPTION_KEY;
  if (!rawKey || typeof rawKey !== 'string' || rawKey.trim() === '') {
    throw new Error(
      'Server configuration error: Dedicated USER_2FA_ENCRYPTION_KEY environment variable is not configured.'
    );
  }

  const cleanKey = rawKey.trim();
  let keyBuffer: Buffer;

  if (/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
    keyBuffer = Buffer.from(cleanKey, 'hex');
  } else if (cleanKey.length === 32) {
    keyBuffer = Buffer.from(cleanKey, 'utf8');
  } else {
    keyBuffer = Buffer.from(cleanKey, 'base64');
  }

  if (keyBuffer.length !== 32) {
    throw new Error(
      'Server configuration error: USER_2FA_ENCRYPTION_KEY must be a valid 256-bit (32-byte) secret key.'
    );
  }

  return keyBuffer;
}

/**
 * Creates a cryptographically signed user 2FA completion session token.
 * Format: v1:user_2fa:<userId>:<verifiedAt>:<exp>:<versionTag>:<hmacHex>
 */
export function createUser2FASessionToken(
  userId: string,
  securityVersion?: string | null
): string {
  if (!userId) throw new Error('userId is required to issue user 2FA session token');

  const verifiedAt = Date.now();
  const exp = verifiedAt + USER_2FA_SESSION_MAX_AGE_SECONDS * 1000;
  const versionTag = securityVersion ? String(securityVersion).trim() : 'v0';

  const payloadString = `v1:user_2fa:${userId}:${verifiedAt}:${exp}:${versionTag}`;
  const key = getUserSessionKey();
  const hmac = crypto.createHmac('sha256', key).update(payloadString).digest('hex');

  return `${payloadString}:${hmac}`;
}

/**
 * Validates a signed user 2FA session token.
 * Returns valid: true if signature matches, token has not expired, userId matches,
 * and securityVersion matches (invalidating sessions if 2FA was rotated or disabled).
 */
export function verifyUser2FASessionToken(
  token: string | null | undefined,
  expectedUserId: string,
  currentSecurityVersion?: string | null
): { valid: boolean; reason?: string } {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'Missing user 2FA session token' };
  }

  try {
    const parts = token.trim().split(':');
    // Expected structure: v1 : user_2fa : userId : verifiedAt : exp : versionTag : hmac
    if (parts.length !== 7 || parts[0] !== 'v1' || parts[1] !== 'user_2fa') {
      return { valid: false, reason: 'Invalid user 2FA token structure' };
    }

    const [, , userId, verifiedAtStr, expStr, versionTag, signature] = parts;

    // 1. User ID binding
    if (userId !== expectedUserId) {
      return { valid: false, reason: 'User ID mismatch on 2FA session token' };
    }

    // 2. Expiration check
    const exp = parseInt(expStr, 10);
    if (isNaN(exp) || Date.now() > exp) {
      return { valid: false, reason: 'User 2FA session token has expired' };
    }

    // 3. Security version check (invalidates old sessions if 2FA was rotated or updated)
    if (currentSecurityVersion && versionTag !== 'v0') {
      const cleanCurrentVersion = String(currentSecurityVersion).trim();
      if (versionTag !== cleanCurrentVersion) {
        return { valid: false, reason: '2FA credentials rotated since session issue' };
      }
    }

    // 4. Cryptographic HMAC verification (timing-safe)
    const payloadString = `v1:user_2fa:${userId}:${verifiedAtStr}:${expStr}:${versionTag}`;
    const key = getUserSessionKey();
    const expectedHmac = crypto.createHmac('sha256', key).update(payloadString).digest('hex');

    const bufA = Buffer.from(signature, 'hex');
    const bufB = Buffer.from(expectedHmac, 'hex');

    if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
      return { valid: false, reason: 'Invalid user 2FA token signature' };
    }

    return { valid: true };
  } catch (err: any) {
    return { valid: false, reason: `User 2FA verification error: ${err.message}` };
  }
}

/**
 * Sets the HttpOnly, Secure, SameSite=Lax user 2FA session cookie on a NextResponse.
 */
export function setUser2FACookie(response: NextResponse, token: string) {
  const isProd = process.env.NODE_ENV === 'production';
  response.cookies.set({
    name: USER_2FA_COOKIE_NAME,
    value: token,
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: USER_2FA_SESSION_MAX_AGE_SECONDS,
  });
}

/**
 * Clears the user 2FA session cookie from a NextResponse.
 */
export function clearUser2FACookie(response: NextResponse) {
  response.cookies.set({
    name: USER_2FA_COOKIE_NAME,
    value: '',
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
