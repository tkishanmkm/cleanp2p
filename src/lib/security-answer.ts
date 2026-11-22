import 'server-only';

import crypto from 'node:crypto';

const SCRYPT_KEY_BYTES = 64;
const SCRYPT_OPTIONS = { N: 16_384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;

function normalizeAnswer(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

function deriveKey(answer: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(answer, salt, SCRYPT_KEY_BYTES, SCRYPT_OPTIONS, (error, derivedKey) => {
      if (error) reject(error);
      else resolve(derivedKey);
    });
  });
}

/** Hashes an answer with a unique salt and a deliberately slow memory-hard KDF. */
export async function hashSecurityAnswer(rawAnswer: string): Promise<string> {
  if (typeof rawAnswer !== 'string') throw new TypeError('Security answer must be text.');
  const answer = normalizeAnswer(rawAnswer);
  if (answer.length < 2 || answer.length > 256) {
    throw new Error('Security answer must contain between 2 and 256 characters.');
  }

  const salt = crypto.randomBytes(16);
  const derivedKey = await deriveKey(answer, salt);
  return [
    'scrypt-v1',
    String(SCRYPT_OPTIONS.N),
    String(SCRYPT_OPTIONS.r),
    String(SCRYPT_OPTIONS.p),
    salt.toString('hex'),
    derivedKey.toString('hex'),
  ].join('$');
}

function constantTimeStringEqual(left: string, right: string): boolean {
  const leftDigest = crypto.createHash('sha256').update(left, 'utf8').digest();
  const rightDigest = crypto.createHash('sha256').update(right, 'utf8').digest();
  return crypto.timingSafeEqual(leftDigest, rightDigest);
}

export type SecurityAnswerVerification = {
  valid: boolean;
  needsRehash: boolean;
};

/**
 * Verifies the current scrypt format and safely supports one-time migration from
 * historical SHA-256, base64, and plaintext values. Callers must rehash and clear
 * the legacy plaintext column immediately after a successful legacy comparison.
 */
export async function verifySecurityAnswer(
  rawAnswer: string,
  storedHash: string | null | undefined,
  legacyPlaintext?: string | null
): Promise<SecurityAnswerVerification> {
  if (typeof rawAnswer !== 'string' || rawAnswer.length > 512) {
    return { valid: false, needsRehash: false };
  }

  const answer = normalizeAnswer(rawAnswer);
  if (!answer) return { valid: false, needsRehash: false };

  const stored = typeof storedHash === 'string' ? storedHash.trim() : '';
  if (stored.startsWith('scrypt-v1$')) {
    const parts = stored.split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt-v1') {
      return { valid: false, needsRehash: false };
    }

    const [n, r, p] = parts.slice(1, 4).map(Number);
    const saltHex = parts[4];
    const expectedHex = parts[5];
    if (
      n !== SCRYPT_OPTIONS.N ||
      r !== SCRYPT_OPTIONS.r ||
      p !== SCRYPT_OPTIONS.p ||
      !/^[a-f0-9]{32}$/i.test(saltHex) ||
      !/^[a-f0-9]{128}$/i.test(expectedHex)
    ) return { valid: false, needsRehash: false };

    const actual = await deriveKey(answer, Buffer.from(saltHex, 'hex'));
    const expected = Buffer.from(expectedHex, 'hex');
    return {
      valid: actual.length === expected.length && crypto.timingSafeEqual(actual, expected),
      needsRehash: false,
    };
  }

  const sha256 = crypto.createHash('sha256').update(answer, 'utf8').digest('hex');
  const base64 = Buffer.from(answer, 'utf8').toString('base64');
  const legacyHashMatch = stored !== '' && (
    constantTimeStringEqual(stored.toLowerCase(), sha256.toLowerCase()) ||
    constantTimeStringEqual(stored, base64)
  );
  const legacyPlain = typeof legacyPlaintext === 'string' ? normalizeAnswer(legacyPlaintext) : '';
  const plaintextMatch = legacyPlain !== '' && constantTimeStringEqual(legacyPlain, answer);

  return {
    valid: legacyHashMatch || plaintextMatch,
    needsRehash: legacyHashMatch || plaintextMatch,
  };
}
