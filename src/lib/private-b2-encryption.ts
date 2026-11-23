import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const PRIVATE_B2_ENCRYPTION_PREFIX = Buffer.from('PAXONES_B2_PRIVATE_V1', 'ascii');
const KYC_ENCRYPTION_PREFIX = Buffer.from('PAXONES_KYC_V1', 'ascii');

function getPrivateB2EncryptionKey(): Buffer {
  const encoded = process.env.B2_PRIVATE_DATA_ENCRYPTION_KEY?.trim() || '';
  if (!/^[a-fA-F0-9]{64}$/.test(encoded)) {
    throw new Error('B2_PRIVATE_DATA_ENCRYPTION_KEY must be a dedicated 32-byte key encoded as 64 hexadecimal characters.');
  }
  return Buffer.from(encoded, 'hex');
}

export function isEncryptedPrivateB2Data(value: Buffer): boolean {
  return Buffer.isBuffer(value) &&
    value.length >= PRIVATE_B2_ENCRYPTION_PREFIX.length + 12 + 16 &&
    value.subarray(0, PRIVATE_B2_ENCRYPTION_PREFIX.length).equals(PRIVATE_B2_ENCRYPTION_PREFIX);
}

/** Encrypt new private B2 objects with a dedicated AES-256-GCM key. */
export function encryptPrivateB2Data(value: Buffer): Buffer {
  if (!Buffer.isBuffer(value)) throw new Error('Private object payload must be a Buffer.');
  // Every private object receives a storage-layer encryption envelope. Never trust a
  // caller-controlled KYC prefix: uploaded binary content can spoof that marker.
  // A private-envelope prefix alone is not proof of a valid AES-GCM ciphertext.
  if (isEncryptedPrivateB2Data(value)) {
    try {
      decryptPrivateB2Data(value); // Verify the authentication tag before accepting an existing envelope.
      return value;
    } catch {
      // Treat invalid or forged markers as ordinary untrusted file bytes and encrypt them.
    }
  }
  const key = getPrivateB2EncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
  return Buffer.concat([
    PRIVATE_B2_ENCRYPTION_PREFIX,
    iv,
    cipher.getAuthTag(),
    ciphertext,
  ]);
}

/** Decrypt private B2 objects. Legacy plaintext objects fail closed and require migration. */
export function decryptPrivateB2Data(value: Buffer): Buffer {
  if (!Buffer.isBuffer(value)) {
    throw new Error('Private B2 object payload is invalid.');
  }
  if (!isEncryptedPrivateB2Data(value)) {
    if (value.subarray(0, PRIVATE_B2_ENCRYPTION_PREFIX.length).equals(PRIVATE_B2_ENCRYPTION_PREFIX)) {
      throw new Error('Encrypted private B2 object header is truncated.');
    }
    // Backward compatibility for legacy KYC envelopes. Newly uploaded KYC files
    // are wrapped by the private B2 key before storage and use this only after the
    // outer envelope has been removed by the normal path below.
    if (value.subarray(0, KYC_ENCRYPTION_PREFIX.length).equals(KYC_ENCRYPTION_PREFIX)) {
      return value;
    }
    throw new Error('Legacy plaintext private B2 objects are disabled pending secure migration.');
  }

  const key = getPrivateB2EncryptionKey();
  const offset = PRIVATE_B2_ENCRYPTION_PREFIX.length;
  const iv = value.subarray(offset, offset + 12);
  const authTag = value.subarray(offset + 12, offset + 28);
  const ciphertext = value.subarray(offset + 28);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
