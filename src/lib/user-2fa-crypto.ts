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
  } else {
    // Base64 string
    keyBuffer = Buffer.from(cleanKey, 'base64');
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
  return parts.length === 5 && parts[0] === 'v1' && parts[1] === 'enc';
}

/**
 * Encrypts a Base32 user TOTP secret using AES-256-GCM.
 * Output format: v1:enc:<ivHex>:<authTagHex>:<ciphertextHex>
 */
export function encryptUserTOTPSecret(secret: string): string {
  if (!secret) return '';
  const cleanSecret = secret.trim();

  // If already encrypted, return as is
  if (isEncryptedUserTOTPSecret(cleanSecret)) {
    return cleanSecret;
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

    const key = getUserEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    console.error('Failed to decrypt User TOTP secret:', err);
    return '';
  }
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
 * Generates a SHA-256 hash of a normalized recovery code for secure database storage.
 */
export function hashUserRecoveryCode(code: string): string {
  const cleanCode = code.replace(/[\s-]+/g, '').toUpperCase().trim();
  return crypto.createHash('sha256').update(cleanCode).digest('hex');
}

/**
 * Constant-time verification of a supplied recovery code against stored SHA-256 hash.
 */
export function verifyUserRecoveryCode(inputCode: string, storedHash: string): boolean {
  if (!inputCode || !storedHash) return false;
  try {
    const inputHash = hashUserRecoveryCode(inputCode);
    const bufA = Buffer.from(inputHash, 'hex');
    const bufB = Buffer.from(storedHash.trim(), 'hex');
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
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
  rawCandidateCode: string
): Promise<boolean> {
  if (!userId || !rawCandidateCode || typeof rawCandidateCode !== 'string') {
    return false;
  }

  const cleanCode = rawCandidateCode.replace(/[\s-]+/g, '').toUpperCase().trim();
  if (cleanCode.length < 8) {
    return false;
  }

  const codeHash = hashUserRecoveryCode(cleanCode);

  try {
    // Primary: Call the atomic SECURITY DEFINER database function
    const { data: rpcResult, error: rpcError } = await adminClient.rpc(
      'consume_user_2fa_recovery_code',
      {
        p_user_id: userId,
        p_code_hash: codeHash,
      }
    );

    if (!rpcError && typeof rpcResult === 'boolean') {
      return rpcResult;
    }

    // Fallback: Atomic conditional update if RPC is pending deployment
    const now = new Date().toISOString();
    const { data: updatedRows, error: updateErr } = await adminClient
      .from('user_2fa_recovery_codes')
      .update({ used_at: now })
      .eq('user_id', userId)
      .eq('code_hash', codeHash)
      .is('used_at', null)
      .is('invalidated_at', null)
      .select('id');

    if (updateErr || !updatedRows || updatedRows.length !== 1) {
      return false;
    }

    return true;
  } catch (err) {
    console.error('Error during atomic recovery code consumption:', err);
    return false;
  }
}

