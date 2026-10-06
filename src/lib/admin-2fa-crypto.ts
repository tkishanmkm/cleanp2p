import crypto from 'crypto';

/**
 * Retrieves and validates the dedicated 256-bit (32-byte) server encryption key.
 * Strictly FAILS CLOSED if ADMIN_2FA_ENCRYPTION_KEY is missing or invalid.
 * NO fallback credentials (such as service role key, API keys, or static seeds) are permitted.
 */
function getAdminEncryptionKey(): Buffer {
  const rawKey = process.env.ADMIN_2FA_ENCRYPTION_KEY;
  if (!rawKey || typeof rawKey !== 'string' || rawKey.trim() === '') {
    throw new Error(
      'Server configuration error: Dedicated ADMIN_2FA_ENCRYPTION_KEY environment variable is not configured.'
    );
  }

  const cleanKey = rawKey.trim();
  let keyBuffer: Buffer;

  if (/^[0-9a-fA-F]{64}$/.test(cleanKey)) {
    // 64-character Hexadecimal string (32 bytes)
    keyBuffer = Buffer.from(cleanKey, 'hex');
  } else if (cleanKey.length === 32) {
    // 32-character raw string (32 bytes)
    keyBuffer = Buffer.from(cleanKey, 'utf8');
  } else {
    // Base64 string
    keyBuffer = Buffer.from(cleanKey, 'base64');
  }

  if (keyBuffer.length !== 32) {
    throw new Error(
      'Server configuration error: ADMIN_2FA_ENCRYPTION_KEY must be a valid 256-bit (32-byte) secret key (e.g. 64-character hex or 32-byte Base64).'
    );
  }

  return keyBuffer;
}

/**
 * Encrypts a Base32 TOTP secret using AES-256-GCM.
 * Output format: v1:enc:<ivHex>:<authTagHex>:<ciphertextHex>
 */
export function encryptAdminTOTPSecret(secret: string): string {
  if (!secret) return '';
  const cleanSecret = secret.trim();

  // If already encrypted, return as is
  if (isEncryptedAdminTOTPSecret(cleanSecret)) {
    return cleanSecret;
  }

  const key = getAdminEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(cleanSecret, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  return `v1:enc:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted TOTP secret.
 * If the input is legacy unencrypted Base32, returns the plaintext string directly.
 */
export function decryptAdminTOTPSecret(encryptedOrPlainSecret: string | null | undefined): string {
  if (!encryptedOrPlainSecret) return '';
  const cleanStr = encryptedOrPlainSecret.trim();

  if (!isEncryptedAdminTOTPSecret(cleanStr)) {
    // Legacy unencrypted Base32 secret string
    return cleanStr;
  }

  try {
    const parts = cleanStr.split(':');
    if (parts.length !== 5 || parts[0] !== 'v1' || parts[1] !== 'enc') {
      return cleanStr;
    }

    const iv = Buffer.from(parts[2], 'hex');
    const authTag = Buffer.from(parts[3], 'hex');
    const ciphertext = parts[4];

    const key = getAdminEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    console.error('Failed to decrypt Admin TOTP secret:', err);
    return '';
  }
}

/**
 * Checks if a string is in versioned AES-256-GCM encrypted format.
 */
export function isEncryptedAdminTOTPSecret(value: string | null | undefined): boolean {
  if (!value) return false;
  return value.startsWith('v1:enc:');
}

/**
 * Hashes a 2FA recovery password using HMAC-SHA256 with the server encryption key as pepper.
 */
export function hashRecoveryPassword(password: string): string {
  if (!password) return '';
  const cleanPassword = password.trim().toLowerCase().replace(/[\s-]+/g, '');
  const key = getAdminEncryptionKey();

  return crypto.createHmac('sha256', key).update(cleanPassword).digest('hex');
}

/**
 * Verifies a candidate recovery password against a stored recovery hash.
 * Supports legacy plain SHA-256 fallback if user upgraded from previous version.
 */
export function verifyRecoveryPasswordHash(candidatePassword: string, storedHash: string | null | undefined): boolean {
  if (!candidatePassword || !storedHash) return false;
  const cleanCandidate = candidatePassword.trim().toLowerCase().replace(/[\s-]+/g, '');

  try {
    // 1. Check peppered HMAC-SHA256
    const hmacHash = hashRecoveryPassword(cleanCandidate);
    if (crypto.timingSafeEqual(Buffer.from(hmacHash), Buffer.from(storedHash))) {
      return true;
    }
  } catch {}

  // 2. Check legacy plain SHA-256
  try {
    const legacyHash = crypto.createHash('sha256').update(cleanCandidate).digest('hex');
    if (storedHash.length === legacyHash.length && crypto.timingSafeEqual(Buffer.from(legacyHash), Buffer.from(storedHash))) {
      return true;
    }
  } catch {}

  return false;
}
