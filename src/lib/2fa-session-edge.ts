/**
 * Edge-runtime-compatible verification for 2FA session cookies.
 * Token creation stays in the Node.js-only session modules; this file intentionally
 * avoids Node crypto/Buffer so middleware can verify tokens with Web Crypto.
 */

export const ADMIN_2FA_COOKIE_NAME = 'pax_admin_2fa_session';
export const USER_2FA_COOKIE_NAME = 'pax_user_2fa_session';

type Verification = { valid: boolean; reason?: string };

function hexToBytes(hex: string): Uint8Array | null {
  if (!/^[0-9a-f]{64}$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer as ArrayBuffer;
}

function decodeSecret(rawKey: string, require32Bytes: boolean): Uint8Array {
  const cleanKey = rawKey.trim();
  let bytes: Uint8Array;

  if (/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
    bytes = hexToBytes(cleanKey) as Uint8Array;
  } else if (cleanKey.length === 32) {
    bytes = new TextEncoder().encode(cleanKey);
  } else {
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(cleanKey)) {
      throw new Error('Invalid 2FA session signing key encoding.');
    }
    const binary = atob(cleanKey);
    if (btoa(binary) !== cleanKey) {
      throw new Error('Non-canonical 2FA session signing key encoding.');
    }
    bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }

  if (bytes.length === 0 || (require32Bytes && bytes.length !== 32)) {
    throw new Error('Invalid 2FA session signing key length.');
  }
  return bytes;
}

async function verifySessionToken(
  token: string | null | undefined,
  expectedUserId: string,
  currentSecurityVersion: string | null | undefined,
  kind: 'admin' | 'user'
): Promise<Verification> {
  if (!token || typeof token !== 'string') {
    return { valid: false, reason: 'Missing 2FA session token' };
  }

  try {
    const parts = token.trim().split(':');
    const expectedPrefix = kind === 'admin' ? 'session' : 'user_2fa';
    if (parts.length !== 7 || parts[0] !== 'v1' || parts[1] !== expectedPrefix) {
      return { valid: false, reason: 'Invalid token structure' };
    }

    const [, , userId, verifiedAtText, expText, versionTag, signature] = parts;
    if (!expectedUserId || userId !== expectedUserId) {
      return { valid: false, reason: '2FA session user ID mismatch' };
    }

    const verifiedAt = Number(verifiedAtText);
    const expiresAt = Number(expText);
    const now = Date.now();
    const maxAgeMs = 12 * 60 * 60 * 1000;
    if (
      !Number.isFinite(verifiedAt) ||
      !Number.isFinite(expiresAt) ||
      verifiedAt <= 0 ||
      expiresAt <= verifiedAt ||
      expiresAt - verifiedAt > maxAgeMs ||
      now > expiresAt
    ) {
      return { valid: false, reason: '2FA session token has expired or invalid timing' };
    }

    if (currentSecurityVersion && versionTag !== 'v0') {
      let decodedVersion: string;
      try {
        decodedVersion = decodeURIComponent(versionTag);
      } catch {
        return { valid: false, reason: 'Invalid 2FA security-version encoding' };
      }
      if (decodedVersion !== String(currentSecurityVersion).trim()) {
        return { valid: false, reason: '2FA credentials rotated since token issue' };
      }
    }

    const rawKey = kind === 'admin'
      ? process.env.ADMIN_2FA_ENCRYPTION_KEY
      : process.env.USER_2FA_ENCRYPTION_KEY;
    if (!rawKey || typeof rawKey !== 'string' || rawKey.trim() === '') {
      return { valid: false, reason: '2FA session signing key is not configured' };
    }

    const keyBytes = decodeSecret(rawKey, true);
    const baseKey = await globalThis.crypto.subtle.importKey(
      'raw',
      toArrayBuffer(keyBytes),
      'HKDF',
      false,
      ['deriveKey']
    );
    const cryptoKey = await globalThis.crypto.subtle.deriveKey(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new TextEncoder().encode('PAXONES_2FA_HKDF_SALT_V1'),
        info: new TextEncoder().encode(
          kind === 'admin'
            ? 'PAXONES_ADMIN_2FA_SESSION_HMAC_V1'
            : 'PAXONES_USER_2FA_SESSION_HMAC_V1'
        ),
      },
      baseKey,
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      false,
      ['verify']
    );
    const signatureBytes = hexToBytes(signature);
    if (!signatureBytes) {
      return { valid: false, reason: 'Invalid token signature encoding' };
    }

    const payload = `v1:${expectedPrefix}:${userId}:${verifiedAtText}:${expText}:${versionTag}`;
    const valid = await globalThis.crypto.subtle.verify(
      'HMAC',
      cryptoKey,
      toArrayBuffer(signatureBytes),
      toArrayBuffer(new TextEncoder().encode(payload))
    );
    return valid
      ? { valid: true }
      : { valid: false, reason: 'Invalid token signature' };
  } catch {
    // Fail closed without leaking cryptographic configuration details.
    return { valid: false, reason: '2FA token verification failed' };
  }
}

export function verifyAdmin2FASessionTokenEdge(
  token: string | null | undefined,
  expectedAdminId: string,
  currentSecurityVersion?: string | null
): Promise<Verification> {
  return verifySessionToken(token, expectedAdminId, currentSecurityVersion, 'admin');
}

export function verifyUser2FASessionTokenEdge(
  token: string | null | undefined,
  expectedUserId: string,
  currentSecurityVersion?: string | null
): Promise<Verification> {
  return verifySessionToken(token, expectedUserId, currentSecurityVersion, 'user');
}
