import 'server-only';

import crypto from 'crypto';

/**
 * Retrieves and validates the dedicated 256-bit (32-byte) server encryption key for User 2FA.
 * Strictly FAILS CLOSED if USER_2FA_ENCRYPTION_KEY is missing or invalid.
 * NEVER uses Supabase service-role key, anon key, JWT secret, or passwords as fallback.
 */
function getUserEncryptionKey(): Buffer {
  const rawKey = process.env.USER_2FA_ENCRYPTION_KEY;
  if (!rawKey || typeof rawKey !== 'string' || rawKey.trim() === '') {
    throw new Error(
      'Server configuration error: Dedicated USER_2FA_ENCRYPTION_KEY environment variable is not configured.'
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
    // Strict canonical Base64; Buffer.from accepts malformed input permissively.
    keyBuffer = Buffer.from(cleanKey, 'base64');
    if (keyBuffer.toString('base64') !== cleanKey) {
      throw new Error('USER_2FA_ENCRYPTION_KEY must be canonical Base64.');
    }
  } else {
    throw new Error('USER_2FA_ENCRYPTION_KEY must be 64 hex characters, 32 UTF-8 bytes, or canonical Base64.');
  }

  if (keyBuffer.length !== 32) {
    throw new Error(
      'Server configuration error: USER_2FA_ENCRYPTION_KEY must be a valid 256-bit (32-byte) secret key (e.g. 64-character hex or 32-byte Base64).'
    );
  }

  return keyBuffer;
}

/**
 * Checks if a string conforms to the versioned AES-256-GCM ciphertext format:
 * v1:enc:<ivHex>:<authTagHex>:<ciphertextHex>
 */
export function isEncryptedUserTOTPSecret(secret: string | null | undefined): boolean {
  if (!secret || typeof secret !== 'string') return false;
  const parts = secret.trim().split(':');
  return parts.length === 5
    && parts[0] === 'v1'
    && parts[1] === 'enc'
    && /^[0-9a-f]{24}$/i.test(parts[2])
    && /^[0-9a-f]{32}$/i.test(parts[3])
    && /^(?:[0-9a-f]{2})+$/i.test(parts[4]);
}

/**
 * Encrypts a Base32 user TOTP secret using AES-256-GCM.
 * Output format: v1:enc:<ivHex>:<authTagHex>:<ciphertextHex>
 */
export function encryptUserTOTPSecret(secret: string): string {
  if (!secret) return '';
  const cleanSecret = secret.trim();

  // Never re-encrypt malformed ciphertext-looking values as if they were plaintext.
  if (cleanSecret.startsWith('v1:enc:')) {
    if (isEncryptedUserTOTPSecret(cleanSecret)) return cleanSecret;
    throw new Error('Stored user TOTP ciphertext has an invalid format.');
  }
  if (!/^[A-Z2-7]{16,128}={0,6}$/i.test(cleanSecret)) {
    throw new Error('User TOTP secret is not a valid Base32 value.');
  }

  const key = getUserEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  let encrypted = cipher.update(cleanSecret, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  return `v1:enc:${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypts an AES-256-GCM encrypted user TOTP secret.
 * If the input is legacy unencrypted Base32, returns the plaintext string directly for compatibility.
 */
export function decryptUserTOTPSecret(encryptedOrPlainSecret: string | null | undefined): string {
  if (!encryptedOrPlainSecret) return '';
  const cleanStr = encryptedOrPlainSecret.trim();

  if (!isEncryptedUserTOTPSecret(cleanStr)) {
    // Retain compatibility with legacy plaintext Base32 secrets, but never
    // reinterpret malformed ciphertext as plaintext and never pass arbitrary
    // database text into the TOTP verifier.
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

    const key = getUserEncryptionKey();
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
 * Ensures legacy user TOTP secrets are migrated to AES-256-GCM before use.
 * The conditional UPDATE protects against overwriting a concurrent rotation;
 * if another request wins, the current database value is re-read and verified.
 */
export async function ensureUserTOTPSecretEncrypted(
  adminClient: any,
  userId: string,
  profile: { totp_secret?: string | null; two_factor_secret?: string | null; role?: string | null; is_admin?: boolean | null; is_admin_account?: boolean | null; admin_2fa_enabled?: boolean | null; admin_2fa_secret?: string | null },
): Promise<string> {
  if (!adminClient || !userId) throw new Error('User 2FA storage is unavailable.');

  const currentSecret = profile.totp_secret || profile.two_factor_secret || '';
  if (!currentSecret) return '';

  const isAdminProfile = Boolean(
    profile.is_admin ||
    profile.is_admin_account ||
    String(profile.role || '').toLowerCase() === 'admin' ||
    profile.admin_2fa_enabled ||
    Boolean(profile.admin_2fa_secret)
  );
  const mirrorLegacyColumn = !isAdminProfile;

  const alreadyEncrypted = isEncryptedUserTOTPSecret(currentSecret);
  if (currentSecret.startsWith('v1:enc:') && !alreadyEncrypted) {
    throw new Error('Stored user TOTP ciphertext is malformed.');
  }

  const encryptedSecret = alreadyEncrypted ? currentSecret : encryptUserTOTPSecret(currentSecret);
  if (!decryptUserTOTPSecret(encryptedSecret)) {
    throw new Error('User TOTP secret could not be authenticated with the server encryption key.');
  }

  if (profile.totp_secret === encryptedSecret && (!mirrorLegacyColumn || profile.two_factor_secret === encryptedSecret)) {
    return encryptedSecret;
  }

  const updateValues: Record<string, string> = { totp_secret: encryptedSecret };
  if (mirrorLegacyColumn) updateValues.two_factor_secret = encryptedSecret;

  let update = adminClient
    .from('profiles')
    .update(updateValues)
    .eq('id', userId);

  update = profile.totp_secret == null
    ? update.is('totp_secret', null)
    : update.eq('totp_secret', profile.totp_secret);
  update = profile.two_factor_secret == null
    ? update.is('two_factor_secret', null)
    : update.eq('two_factor_secret', profile.two_factor_secret);

  const { data: updatedRows, error: updateError } = await update.select('id');
  if (updateError) {
    console.error('[User 2FA] Legacy TOTP encryption migration failed:', updateError.code || 'database_error');
    throw new Error('User 2FA secret could not be encrypted and saved.');
  }
  if (Array.isArray(updatedRows) && updatedRows.length === 1) return encryptedSecret;

  // A concurrent rotation may have changed the row. Never use the stale value:
  // read the latest encrypted secret and fail closed if it is missing or invalid.
  const { data: latestProfile, error: latestError } = await adminClient
    .from('profiles')
    .select('totp_secret, two_factor_secret')
    .eq('id', userId)
    .maybeSingle();
  if (latestError || !latestProfile) {
    throw new Error('Current user 2FA secret could not be verified.');
  }

  const latestSecret = latestProfile.totp_secret || '';
  if (
    !latestSecret ||
    (mirrorLegacyColumn && latestProfile.two_factor_secret !== latestSecret) ||
    !isEncryptedUserTOTPSecret(latestSecret) ||
    !decryptUserTOTPSecret(latestSecret)
  ) {
    throw new Error('User 2FA secret changed and could not be safely migrated.');
  }
  return latestSecret;
}

/**
 * Generates an array of secure random single-use recovery codes.
 * Format: XXXX-XXXX-XXXX (12 alphanumeric characters per code)
 */
export function generateUserRecoveryCodes(count: number = 8): string[] {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const codes: string[] = [];
  for (let i = 0; i < count; i++) {
    let p1 = '';
    let p2 = '';
    let p3 = '';
    for (let j = 0; j < 4; j++) {
      p1 += chars.charAt(crypto.randomInt(chars.length));
      p2 += chars.charAt(crypto.randomInt(chars.length));
      p3 += chars.charAt(crypto.randomInt(chars.length));
    }
    codes.push(`${p1}-${p2}-${p3}`);
  }
  return codes;
}

/**
 * Purpose-separated HMAC-SHA256 hash. Recovery codes are generated with
 * cryptographic randomness; using a server-only pepper prevents offline
 * verification after a recovery-code table dump.
 */
export function hashUserRecoveryCode(code: string): string {
  const cleanCode = code.replace(/[\s-]+/g, '').toUpperCase().trim();
  if (!/^[A-Z2-9]{8,64}$/.test(cleanCode)) {
    throw new Error('Invalid user 2FA recovery code format.');
  }
  const key = Buffer.from(crypto.hkdfSync(
    'sha256',
    getUserEncryptionKey(),
    Buffer.from('PAXONES_2FA_HKDF_SALT_V1', 'utf8'),
    Buffer.from('PAXONES_USER_2FA_RECOVERY_HMAC_V1', 'utf8'),
    32,
  ));
  return crypto.createHmac('sha256', key).update(cleanCode).digest('hex');
}

/** Legacy SHA-256 compatibility only; new code must never persist this form. */
export function hashLegacyUserRecoveryCode(code: string): string {
  const cleanCode = code.replace(/[\s-]+/g, '').toUpperCase().trim();
  if (!/^[A-Z2-9]{8,64}$/.test(cleanCode)) return '';
  return crypto.createHash('sha256').update(cleanCode).digest('hex');
}

/** Constant-time verification supports legacy SHA-256 hashes during migration. */
export function verifyUserRecoveryCode(inputCode: string, storedHash: string): boolean {
  if (!inputCode || !/^[0-9a-f]{64}$/i.test(storedHash || '')) return false;
  try {
    const normalized = inputCode.replace(/[\s-]+/g, '').toUpperCase().trim();
    const candidates = [hashUserRecoveryCode(normalized), hashLegacyUserRecoveryCode(normalized)];
    const stored = Buffer.from(storedHash, 'hex');
    return candidates.some((hash) => {
      const candidate = Buffer.from(hash, 'hex');
      return candidate.length === stored.length && crypto.timingSafeEqual(candidate, stored);
    });
  } catch {
    return false;
  }
}

/**
 * Atomically consumes a user recovery code in the database.
 * Returns true if and only if exactly one unused/non-invalidated code was consumed.
 */
export async function consumeUserRecoveryCodeAtomic(
  adminClient: any,
  userId: string,
  rawCandidateCode: string,
  context = '2fa_verification'
): Promise<boolean> {
  if (!userId || !rawCandidateCode || typeof rawCandidateCode !== 'string') {
    return false;
  }

  const cleanCode = rawCandidateCode.replace(/[\s-]+/g, '').toUpperCase().trim();
  if (cleanCode.length < 8 || cleanCode.length > 64 || !/^[A-Z2-9]+$/.test(cleanCode)) {
    return false;
  }

  const codeHash = hashUserRecoveryCode(cleanCode);
  const legacyCodeHash = hashLegacyUserRecoveryCode(cleanCode);

  const { data, error } = await adminClient.rpc('consume_user_2fa_recovery_code_with_audit', {
    p_user_id: userId,
    p_code_hash: codeHash,
    p_legacy_code_hash: legacyCodeHash,
    p_context: context,
  });
  if (error) {
    console.error('[User 2FA] Atomic recovery-code consumption failed:', error.code || 'unknown');
    throw new Error('Recovery-code verification is temporarily unavailable.');
  }
  if (typeof data !== 'boolean') {
    throw new Error('Recovery-code verification returned an invalid database response.');
  }
  return data;
}

