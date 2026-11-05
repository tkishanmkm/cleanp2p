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
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
    key = Buffer.from(cleanKey, 'hex');
  } else if (cleanKey.length === 32) {
    key = Buffer.from(cleanKey, 'utf8');
  } else if (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(cleanKey)) {
    key = Buffer.from(cleanKey, 'base64');
    if (key.toString('base64') !== cleanKey) {
      throw new Error('ADMIN_2FA_ENCRYPTION_KEY must be canonical Base64.');
    }
  } else {
    throw new Error('ADMIN_2FA_ENCRYPTION_KEY must encode exactly 32 bytes using 64 hex characters, 32 UTF-8 bytes, or Base64.');
  }

  if (key.length !== 32) {
    throw new Error('ADMIN_2FA_ENCRYPTION_KEY must decode to exactly 32 bytes.');
  }
  return key;
}

/** Purpose-separate the cookie-signing key from the AES-GCM TOTP encryption key. */
function getAdminSessionSigningKey(): Buffer {
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    getAdminSessionKey(),
    Buffer.from('PAXONES_2FA_HKDF_SALT_V1', 'utf8'),
    Buffer.from('PAXONES_ADMIN_2FA_SESSION_HMAC_V1', 'utf8'),
    32,
  ));
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
  const versionTag = securityVersion ? encodeURIComponent(String(securityVersion).trim()) : 'v0';

  const payloadString = `v1:session:${adminId}:${verifiedAt}:${exp}:${versionTag}`;
  const key = getAdminSessionSigningKey();
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
    const verifiedAt = Number(verifiedAtStr);
    const exp = Number(expStr);
    const now = Date.now();
    if (
      !Number.isFinite(verifiedAt) ||
      !Number.isFinite(exp) ||
      verifiedAt <= 0 ||
      exp <= verifiedAt ||
      exp - verifiedAt > ADMIN_2FA_SESSION_MAX_AGE_SECONDS * 1000 ||
      verifiedAt > now + 10_000 ||
      now > exp
    ) {
      return { valid: false, reason: '2FA session token has expired' };
    }

    // 3. Check security version if present
    if (currentSecurityVersion && versionTag !== 'v0') {
      let decodedVersionTag: string;
      try {
        decodedVersionTag = decodeURIComponent(versionTag);
      } catch {
        return { valid: false, reason: 'Invalid 2FA security-version encoding' };
      }
      const cleanCurrentVersion = String(currentSecurityVersion).trim();
      if (decodedVersionTag !== cleanCurrentVersion) {
        return { valid: false, reason: '2FA credentials rotated since token issue' };
      }
    }

    // 4. Verify cryptographic signature
    const payloadString = `v1:session:${adminId}:${verifiedAtStr}:${expStr}:${versionTag}`;
    if (!/^[0-9a-f]{64}$/i.test(signature)) {
      return { valid: false, reason: 'Invalid token signature encoding' };
    }
    const key = getAdminSessionSigningKey();
    const expectedHmac = crypto.createHmac('sha256', key).update(payloadString).digest('hex');
    const signatureBuffer = Buffer.from(signature, 'hex');
    const expectedBuffer = Buffer.from(expectedHmac, 'hex');

    if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
      return { valid: false, reason: 'Invalid token signature' };
    }

    return { valid: true };
  } catch {
    return { valid: false, reason: '2FA session verification failed' };
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
