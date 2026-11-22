import 'server-only';

import crypto from 'crypto';
import { decryptUserTOTPSecret, encryptUserTOTPSecret, isEncryptedUserTOTPSecret } from '@/lib/user-2fa-crypto';

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
  } else if (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(cleanKey)) {
    // Strict standard Base64; Buffer.from alone accepts malformed input.
    keyBuffer = Buffer.from(cleanKey, 'base64');
    if (keyBuffer.toString('base64') !== cleanKey) {
      throw new Error('ADMIN_2FA_ENCRYPTION_KEY must be canonical Base64.');
    }
  } else {
    throw new Error('ADMIN_2FA_ENCRYPTION_KEY must be 64 hex characters, 32 UTF-8 bytes, or canonical Base64.');
  }

  if (keyBuffer.length !== 32) {
    throw new Error(
      'Server configuration error: ADMIN_2FA_ENCRYPTION_KEY must be a valid 256-bit (32-byte) secret key (e.g. 64-character hex or 32-byte Base64).'
    );
  }

  return keyBuffer;
}

/** Separate recovery-code HMAC use from the AES-GCM TOTP encryption key. */
function getAdminRecoveryPepper(): Buffer {
  return Buffer.from(crypto.hkdfSync(
    'sha256',
    getAdminEncryptionKey(),
    Buffer.from('PAXONES_2FA_HKDF_SALT_V1', 'utf8'),
    Buffer.from('PAXONES_ADMIN_2FA_RECOVERY_HMAC_V1', 'utf8'),
    32,
  ));
}

/**
 * Encrypts a Base32 TOTP secret using AES-256-GCM.
 * Output format: v1:enc:<ivHex>:<authTagHex>:<ciphertextHex>
 */
export function encryptAdminTOTPSecret(secret: string): string {
  if (!secret) return '';
  const cleanSecret = secret.trim();

  // Never reinterpret malformed ciphertext-looking values as plaintext.
  if (cleanSecret.startsWith('v1:enc:')) {
    if (isEncryptedAdminTOTPSecret(cleanSecret)) return cleanSecret;
    throw new Error('Stored administrator TOTP ciphertext has an invalid format.');
  }
  if (!/^[A-Z2-7]{16,128}={0,6}$/i.test(cleanSecret)) {
    throw new Error('Administrator TOTP secret is not a valid Base32 value.');
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
    // Keep legacy Base32 compatibility for one-way migration, but never pass
    // malformed ciphertext or arbitrary database text to the TOTP verifier.
    if (cleanStr.startsWith('v1:enc:')) return '';
    return /^[A-Z2-7]{16,128}={0,6}$/i.test(cleanStr) ? cleanStr.toUpperCase() : '';
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

    if (!/^[A-Z2-7]{16,128}={0,6}$/i.test(decrypted)) return '';
    return decrypted.toUpperCase();
  } catch {
    // Never log decrypted material or low-level crypto errors.
    return '';
  }
}

/**
 * Checks if a string is in versioned AES-256-GCM encrypted format.
 */
export function isEncryptedAdminTOTPSecret(value: string | null | undefined): boolean {
  if (!value || typeof value !== 'string') return false;
  const parts = value.trim().split(':');
  return parts.length === 5
    && parts[0] === 'v1'
    && parts[1] === 'enc'
    && /^[0-9a-f]{24}$/i.test(parts[2])
    && /^[0-9a-f]{32}$/i.test(parts[3])
    && /^(?:[0-9a-f]{2})+$/i.test(parts[4]);
}

/**
 * Ensures legacy administrator TOTP secrets are stored using AES-256-GCM.
 * Conditional predicates prevent a stale read from overwriting a concurrent
 * authenticator rotation. Encryption-only rewrites do not change session version.
 */
export async function ensureAdminTOTPSecretEncrypted(
  adminClient: any,
  adminId: string,
  profile: { admin_2fa_secret?: string | null; two_factor_secret?: string | null; totp_secret?: string | null; role?: string | null; is_admin?: boolean | null; is_admin_account?: boolean | null; admin_2fa_enabled?: boolean | null; is_2fa_enabled?: boolean | null; is_mfa_enabled?: boolean | null; two_factor_enabled?: boolean | null },
): Promise<string> {
  if (!adminClient || !adminId) throw new Error('Administrator 2FA storage is unavailable.');

  const isAdminProfile = Boolean(
    profile.is_admin ||
    profile.is_admin_account ||
    String(profile.role || '').toLowerCase() === 'admin'
  );
  const user2FAEnabled = Boolean(
    profile.is_2fa_enabled || profile.is_mfa_enabled || profile.two_factor_enabled
  );
  const admin2FAEnabled = Boolean(
    profile.admin_2fa_enabled || (isAdminProfile && user2FAEnabled)
  );

  const dedicatedAdminSecret = profile.admin_2fa_secret || '';
  const legacySharedSecret = profile.two_factor_secret || '';
  if (!dedicatedAdminSecret && !admin2FAEnabled) return '';

  // Admin and user 2FA use different keys. If the old shared column is the
  // only remaining source, split it into role-specific encrypted columns
  // atomically, then clear the plaintext compatibility column.
  let adminPlainSecret = '';
  let dedicatedAdminCipherValid = false;
  if (dedicatedAdminSecret) {
    if (isEncryptedAdminTOTPSecret(dedicatedAdminSecret)) {
      adminPlainSecret = decryptAdminTOTPSecret(dedicatedAdminSecret);
      dedicatedAdminCipherValid = Boolean(adminPlainSecret);
      if (!adminPlainSecret && isEncryptedUserTOTPSecret(dedicatedAdminSecret)) {
        adminPlainSecret = decryptUserTOTPSecret(dedicatedAdminSecret);
      }
      if (!adminPlainSecret) throw new Error('Administrator TOTP ciphertext failed authentication.');
    } else if (dedicatedAdminSecret.startsWith('v1:enc:')) {
      throw new Error('Administrator TOTP ciphertext is malformed.');
    } else {
      adminPlainSecret = dedicatedAdminSecret;
    }
  } else if (legacySharedSecret) {
    if (isEncryptedAdminTOTPSecret(legacySharedSecret)) {
      adminPlainSecret = decryptAdminTOTPSecret(legacySharedSecret);
      if (!adminPlainSecret && isEncryptedUserTOTPSecret(legacySharedSecret)) {
        adminPlainSecret = decryptUserTOTPSecret(legacySharedSecret);
      }
    } else if (isEncryptedUserTOTPSecret(legacySharedSecret)) {
      adminPlainSecret = decryptUserTOTPSecret(legacySharedSecret);
    } else if (legacySharedSecret.startsWith('v1:enc:')) {
      throw new Error('Legacy administrator TOTP ciphertext is malformed.');
    } else {
      adminPlainSecret = legacySharedSecret;
    }
    if (!adminPlainSecret) throw new Error('Legacy administrator TOTP secret could not be authenticated.');
  } else if (admin2FAEnabled) {
    throw new Error('Enabled administrator account has no authenticator secret.');
  }

  const encryptedAdminSecret = adminPlainSecret
    ? (dedicatedAdminCipherValid ? dedicatedAdminSecret : encryptAdminTOTPSecret(adminPlainSecret))
    : '';

  if (encryptedAdminSecret && !decryptAdminTOTPSecret(encryptedAdminSecret)) {
    throw new Error('Administrator TOTP secret could not be authenticated with the server encryption key.');
  }

  let encryptedUserSecret = '';
  if (user2FAEnabled) {
    const userSource = profile.totp_secret || legacySharedSecret;
    if (!userSource) throw new Error('Enabled user account has no authenticator secret.');

    let userPlainSecret = '';
    const existingUserPlain = decryptUserTOTPSecret(userSource);
    const existingAdminPlain = !existingUserPlain ? decryptAdminTOTPSecret(userSource) : '';
    if (existingUserPlain) {
      encryptedUserSecret = userSource;
      userPlainSecret = existingUserPlain;
    } else if (existingAdminPlain) {
      userPlainSecret = existingAdminPlain;
    } else if (userSource.startsWith('v1:enc:')) {
      throw new Error('Legacy user TOTP ciphertext could not be authenticated with either role key.');
    } else {
      userPlainSecret = userSource;
    }

    if (!encryptedUserSecret) encryptedUserSecret = encryptUserTOTPSecret(userPlainSecret);
    if (!decryptUserTOTPSecret(encryptedUserSecret)) {
      throw new Error('User TOTP secret could not be securely separated from the legacy shared column.');
    }
  }

  const updateValues: Record<string, string | null> = {};
  if (encryptedAdminSecret && dedicatedAdminSecret !== encryptedAdminSecret) {
    updateValues.admin_2fa_secret = encryptedAdminSecret;
  }
  if (user2FAEnabled && profile.totp_secret !== encryptedUserSecret) {
    updateValues.totp_secret = encryptedUserSecret;
  }
  if (legacySharedSecret) updateValues.two_factor_secret = null;

  if (Object.keys(updateValues).length === 0) return encryptedAdminSecret;

  let update = adminClient.from('profiles').update(updateValues).eq('id', adminId);
  update = profile.admin_2fa_secret == null
    ? update.is('admin_2fa_secret', null)
    : update.eq('admin_2fa_secret', profile.admin_2fa_secret);
  update = profile.two_factor_secret == null
    ? update.is('two_factor_secret', null)
    : update.eq('two_factor_secret', profile.two_factor_secret);
  update = profile.totp_secret == null
    ? update.is('totp_secret', null)
    : update.eq('totp_secret', profile.totp_secret);

  const { data: updatedRows, error: updateError } = await update.select('id');
  if (updateError) {
    console.error('[Admin 2FA] TOTP role-separation migration failed:', updateError.code || 'database_error');
    throw new Error('Administrator 2FA secrets could not be safely separated and saved.');
  }
  if (Array.isArray(updatedRows) && updatedRows.length === 1) return encryptedAdminSecret;

  // A concurrent rotation won the compare-and-set. Verify the latest role-specific
  // columns before returning anything; never accept a stale shared-column value.
  const { data: latestProfile, error: latestError } = await adminClient
    .from('profiles')
    .select('admin_2fa_secret, totp_secret, two_factor_secret')
    .eq('id', adminId)
    .maybeSingle();
  if (latestError || !latestProfile) {
    throw new Error('Current administrator 2FA state could not be verified.');
  }

  const latestAdminSecret = latestProfile.admin_2fa_secret || '';
  const latestUserSecret = latestProfile.totp_secret || '';
  if (
    (admin2FAEnabled && (!isEncryptedAdminTOTPSecret(latestAdminSecret) || !decryptAdminTOTPSecret(latestAdminSecret))) ||
    (user2FAEnabled && (!isEncryptedUserTOTPSecret(latestUserSecret) || !decryptUserTOTPSecret(latestUserSecret))) ||
    latestProfile.two_factor_secret !== null
  ) {
    throw new Error('Administrator 2FA secrets changed and could not be safely separated.');
  }
  return latestAdminSecret;
}

/**
 * Hashes a 2FA recovery password using HMAC-SHA256 with the server encryption key as pepper.
 */
export function hashRecoveryPassword(password: string): string {
  if (!password) return '';
  const cleanPassword = password.trim().toLowerCase().replace(/[\s-]+/g, '');
  const key = getAdminRecoveryPepper();

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
    // 1. Check the purpose-separated HKDF recovery pepper.
    const hmacHash = hashRecoveryPassword(cleanCandidate);
    if (/^[0-9a-f]{64}$/i.test(storedHash) &&
        crypto.timingSafeEqual(Buffer.from(hmacHash, 'hex'), Buffer.from(storedHash, 'hex'))) {
      return true;
    }
  } catch {}

  // 2. One-time compatibility: accept the previous HMAC construction while
  // users migrate their recovery codes. New hashes always use the HKDF subkey.
  try {
    const legacyHmac = crypto.createHmac('sha256', getAdminEncryptionKey())
      .update(cleanCandidate)
      .digest('hex');
    if (/^[0-9a-f]{64}$/i.test(storedHash) &&
        crypto.timingSafeEqual(Buffer.from(legacyHmac, 'hex'), Buffer.from(storedHash, 'hex'))) {
      return true;
    }
  } catch {}

  // 3. Check legacy plain SHA-256
  try {
    const legacyHash = crypto.createHash('sha256').update(cleanCandidate).digest('hex');
    if (storedHash.length === legacyHash.length && crypto.timingSafeEqual(Buffer.from(legacyHash), Buffer.from(storedHash))) {
      return true;
    }
  } catch {}

  return false;
}
