import 'server-only';
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import zlib from 'zlib';

/**
 * Safely obtain sharp instance if installed and native bindings are available.
 */
async function getSharpInstance() {
  try {
    const sharpModule = await import('sharp');
    return (sharpModule as any).default || sharpModule;
  } catch {
    return null;
  }
}

/**
 * Directly fetch Backblaze B2 credentials and endpoints from environment variables at runtime.
 * Supports standard Backblaze B2 environment variable naming:
 * - B2_APPLICATION_KEY_ID (aliases: B2_ACCESS_KEY_ID, B2_KEY_ID)
 * - B2_APPLICATION_KEY (aliases: B2_SECRET_ACCESS_KEY, B2_APP_KEY)
 * - B2_BUCKET_NAME
 * - B2_BUCKET_REGION (alias: B2_REGION)
 * - B2_ENDPOINT
 */
export function getB2Config() {
  const keyId =
    process.env.B2_APPLICATION_KEY_ID ||
    process.env.B2_ACCESS_KEY_ID ||
    process.env.B2_KEY_ID ||
    process.env.AWS_ACCESS_KEY_ID ||
    '';

  const applicationKey =
    process.env.B2_APPLICATION_KEY ||
    process.env.B2_SECRET_ACCESS_KEY ||
    process.env.B2_APP_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY ||
    '';

  const bucketName = process.env.B2_BUCKET_NAME || process.env.AWS_BUCKET_NAME || '';
  const region = process.env.B2_BUCKET_REGION || process.env.B2_REGION || process.env.AWS_REGION || 'us-east-005';
  const rawEndpoint = process.env.B2_ENDPOINT || process.env.AWS_ENDPOINT_URL || `https://s3.${region}.backblazeb2.com`;
  const endpoint = rawEndpoint.startsWith('http') ? rawEndpoint : `https://${rawEndpoint}`;
  let endpointIsValid = false;
  try {
    const parsedEndpoint = new URL(endpoint);
    const endpointHost = parsedEndpoint.hostname.toLowerCase();
    const isBackblazeEndpoint = endpointHost === 'backblazeb2.com'
      || endpointHost.endsWith('.backblazeb2.com');
    endpointIsValid =
      parsedEndpoint.protocol === 'https:' &&
      isBackblazeEndpoint &&
      !parsedEndpoint.username &&
      !parsedEndpoint.password &&
      (parsedEndpoint.port === '' || parsedEndpoint.port === '443') &&
      !parsedEndpoint.search &&
      !parsedEndpoint.hash;
  } catch {
    endpointIsValid = false;
  }

  return {
    keyId,
    applicationKey,
    bucketName,
    region,
    endpoint,
    isConfigured: Boolean(keyId && applicationKey && bucketName && region && endpointIsValid),
  };
}

/**
 * Returns an instantiated S3Client for Backblaze B2 using runtime env values.
 */
export function getB2Client(): S3Client {
  const config = getB2Config();
  if (!config.isConfigured) {
    throw new Error('Backblaze B2 is not fully configured. Set B2 credentials and bucket settings before storage operations.');
  }

  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.keyId,
      secretAccessKey: config.applicationKey,
    },
    forcePathStyle: true,
  });
}

export const isB2Configured = () => getB2Config().isConfigured;
export const B2_BUCKET = process.env.B2_BUCKET_NAME || '';

// ==========================================
// COMPRESSION ENGINES
// ==========================================

/**
 * Compresses and resizes Display Pictures (DP / Avatars)
 * Converts to ultra-efficient WebP, 75% quality, max 256x256 resolution (approx 10-25 KB).
 */
export async function compressAvatar(buffer: Buffer): Promise<{
  buffer: Buffer;
  contentType: string;
  extension: string;
}> {
  try {
    const sharp = await getSharpInstance();
    if (!sharp) {
      return {
        buffer,
        contentType: 'image/jpeg',
        extension: 'jpg',
      };
    }

    const compressed = await sharp(buffer)
      .resize(256, 256, {
        fit: 'cover',
        withoutEnlargement: true,
      })
      .webp({ quality: 75, effort: 6 })
      .toBuffer();

    return {
      buffer: compressed,
      contentType: 'image/webp',
      extension: 'webp',
    };
  } catch (err) {
    console.warn('Sharp avatar compression failed, falling back to original buffer:', err);
    return {
      buffer,
      contentType: 'image/jpeg',
      extension: 'jpg',
    };
  }
}

/**
 * Compresses Trade Chat Media (Images, Photos, Screenshots, Documents)
 */
export async function compressTradeMedia(
  buffer: Buffer,
  mimeType: string,
  fileName: string
): Promise<{
  buffer: Buffer;
  contentType: string;
  fileName: string;
  isCompressed: boolean;
}> {
  // If image: compress via sharp
  if (mimeType.startsWith('image/')) {
    try {
      const sharp = await getSharpInstance();
      if (!sharp) {
        return { buffer, contentType: mimeType, fileName, isCompressed: false };
      }

      const metadata = await sharp(buffer).metadata();
      const isAnimated = (metadata.pages || 1) > 1;

      // If animated gif or webp with multiple frames, optimize without breaking animation
      if (isAnimated) {
        return {
          buffer,
          contentType: mimeType,
          fileName,
          isCompressed: false,
        };
      }

      const compressed = await sharp(buffer)
        .resize({
          width: 1920,
          height: 1920,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ quality: 80, effort: 4 })
        .toBuffer();

      const baseName = fileName.replace(/\.[^/.]+$/, '');
      return {
        buffer: compressed,
        contentType: 'image/webp',
        fileName: `${baseName}.webp`,
        isCompressed: true,
      };
    } catch (sharpErr) {
      console.warn('Trade image compression failed, using original:', sharpErr);
      return { buffer, contentType: mimeType, fileName, isCompressed: false };
    }
  }

  // If text document (JSON, TXT, CSV, LOG, HTML)
  const isTextDoc =
    mimeType.startsWith('text/') ||
    mimeType === 'application/json' ||
    mimeType === 'application/xml' ||
    fileName.endsWith('.txt') ||
    fileName.endsWith('.csv') ||
    fileName.endsWith('.json');

  if (isTextDoc && buffer.length > 512) {
    try {
      const gzipped = zlib.gzipSync(buffer, { level: 9 });
      return {
        buffer: gzipped,
        contentType: mimeType,
        fileName,
        isCompressed: true,
      };
    } catch (gzipErr) {
      console.warn('Document compression fallback:', gzipErr);
    }
  }

  // Default binary files (PDFs, Videos, etc.)
  return {
    buffer,
    contentType: mimeType || 'application/octet-stream',
    fileName,
    isCompressed: false,
  };
}

/**
 * Compresses KYC Document / Address details JSON to Backblaze B2
 */
export async function compressKycData(data: Record<string, any>): Promise<Buffer> {
  const jsonStr = JSON.stringify({
    ...data,
    _timestamp: new Date().toISOString(),
  });
  return zlib.gzipSync(Buffer.from(jsonStr, 'utf-8'), { level: 9 });
}

function getKycDataEncryptionKey(): Buffer {
  const encoded = process.env.KYC_DATA_ENCRYPTION_KEY?.trim() || '';
  if (!/^[a-fA-F0-9]{64}$/.test(encoded)) {
    throw new Error('KYC_DATA_ENCRYPTION_KEY must be a 32-byte key encoded as 64 hexadecimal characters.');
  }
  return Buffer.from(encoded, 'hex');
}

/** Encrypt compressed KYC data with AES-256-GCM before sending it to object storage. */
export function encryptKycData(compressed: Buffer): Buffer {
  const key = getKycDataEncryptionKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from('PAXONES_KYC_V1', 'ascii'), iv, authTag, ciphertext]);
}

/** Decrypt stored KYC payloads created by encryptKycData. */
export function decryptKycData(encrypted: Buffer): Buffer {
  const prefix = Buffer.from('PAXONES_KYC_V1', 'ascii');
  const headerLength = prefix.length + 12 + 16;
  if (encrypted.length < headerLength || !encrypted.subarray(0, prefix.length).equals(prefix)) {
    throw new Error('Unsupported or invalid encrypted KYC document format.');
  }
  const key = getKycDataEncryptionKey();
  const iv = encrypted.subarray(prefix.length, prefix.length + 12);
  const authTag = encrypted.subarray(prefix.length + 12, headerLength);
  const ciphertext = encrypted.subarray(headerLength);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

export const isKycDataEncryptionConfigured = (): boolean => {
  try {
    getKycDataEncryptionKey();
    return true;
  } catch {
    return false;
  }
};

// ==========================================
// BACKBLAZE B2 OPERATIONS
// ==========================================

/**
 * B2 is private-by-default. Only strictly named UUID avatar objects are public;
 * every unknown/new object namespace is encrypted before it leaves the server.
 */
export function isPrivateB2Key(key: string): boolean {
  if (typeof key !== 'string' || key.length === 0 || key.length > 512) return true;
  const normalized = key.replace(/^\/+/, '');
  const isSafePublicAvatar =
    /^avatars\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:\.(?:webp|jpg|jpeg|png))?$/i
      .test(normalized);
  return !isSafePublicAvatar;
}

function assertSafeB2ObjectKey(key: string): void {
  if (
    typeof key !== 'string' ||
    key.length < 1 ||
    key.length > 512 ||
    key.startsWith('/') ||
    key.includes('\\') ||
    key.includes('\0') ||
    key.split('/').some((part) => !part || part === '.' || part === '..') ||
    /[\r\n]/.test(key)
  ) {
    throw new Error('Invalid B2 object key.');
  }
}

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
  if (isEncryptedPrivateB2Data(value)) return value;
  if (value.subarray(0, KYC_ENCRYPTION_PREFIX.length).equals(KYC_ENCRYPTION_PREFIX)) {
    return value; // KYC payloads already use their dedicated KYC_DATA_ENCRYPTION_KEY.
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
    // KYC objects use their own dedicated AES-GCM key and are decrypted by
    // decryptKycData after this storage-layer boundary.
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

/**
 * Uploads any buffer directly to Backblaze B2 using runtime env credentials.
 * Every new private object is application-encrypted before it leaves this process.
 */
export async function uploadToB2(
  key: string,
  buffer: Buffer,
  contentType: string,
  contentEncoding?: string
): Promise<{ key: string; publicUrl: string; bucket: string; isPrivate: boolean }> {
  assertSafeB2ObjectKey(key);
  if (!Buffer.isBuffer(buffer) || buffer.length > 32 * 1024 * 1024) {
    throw new Error('B2 upload payload is invalid or exceeds the 32 MB limit.');
  }

  const config = getB2Config();
  const client = getB2Client();

  const isPrivate = isPrivateB2Key(key);
  const storedBuffer = isPrivate ? encryptPrivateB2Data(buffer) : buffer;
  const command = new PutObjectCommand({
    Bucket: config.bucketName,
    Key: key,
    Body: storedBuffer,
    ContentType: contentType,
    ContentEncoding: contentEncoding,
    Metadata: isPrivate ? { paxones_encryption: 'aes-256-gcm-v1' } : undefined,
  });

  await client.send(command);

  // Sensitive documents (KYC, address proof, dispute files) MUST NEVER have accessible public URLs
  const publicUrl = isPrivate
    ? ''
    : `${config.endpoint.replace(/\/+$/, '')}/${config.bucketName}/${key}`;

  return {
    key,
    publicUrl,
    bucket: config.bucketName,
    isPrivate,
  };
}

/**
 * Saves compressed KYC details (e.g. Address, Country, ID info) directly into Backblaze B2
 */
export async function saveKycAddressToB2(
  userId: string,
  kycDetails: {
    country?: string;
    address?: string;
    street?: string;
    city?: string;
    postalCode?: string;
    docType?: string;
    docNumber?: string;
    [key: string]: any;
  }
): Promise<{ key: string; success: boolean }> {
  try {
    if (!isB2Configured()) {
      throw new Error('Backblaze B2 storage is not configured.');
    }
    const compressedBuffer = await compressKycData(kycDetails);
    const encryptedBuffer = encryptKycData(compressedBuffer);
    const key = `kyc-documents/${userId}/address_data_${Date.now()}.json.gz.enc`;

    await uploadToB2(key, encryptedBuffer, 'application/octet-stream');

    return { key, success: true };
  } catch (err) {
    console.error('Failed to save encrypted KYC address data to B2:', err instanceof Error ? err.name : 'unknown_error');
    return { key: '', success: false };
  }
}

/**
 * Generates presigned download URL for private KYC / Trade documents or avatars
 * Defaults to 24 hours (86400s) for media delivery
 */
export async function getPresignedDownloadUrl(
  key: string,
  expiresInSeconds = 900
): Promise<string> {
  assertSafeB2ObjectKey(key);
  if (isPrivateB2Key(key)) {
    throw new Error('Private B2 objects must be served through an authenticated application proxy.');
  }
  const safeExpiry = Number.isInteger(expiresInSeconds)
    ? Math.max(1, Math.min(expiresInSeconds, 900))
    : 900;
  const config = getB2Config();
  const client = getB2Client();

  const command = new GetObjectCommand({
    Bucket: config.bucketName,
    Key: key,
  });

  return await getSignedUrl(client, command, { expiresIn: safeExpiry });
}

/**
 * Downloads object from Backblaze B2 as a Buffer with automatic Gzip decompression
 */
export async function downloadFromB2(
  key: string
): Promise<{ buffer: Buffer; contentType?: string; contentEncoding?: string } | null> {
  try {
    assertSafeB2ObjectKey(key);
    const config = getB2Config();
    const client = getB2Client();

    const command = new GetObjectCommand({
      Bucket: config.bucketName,
      Key: key,
    });

    const response = await client.send(command);
    if (!response.Body) return null;

    const maxStoredObjectBytes = 32 * 1024 * 1024 + 64;
    if (typeof response.ContentLength === 'number' && response.ContentLength > maxStoredObjectBytes) {
      throw new Error('Stored object exceeds the configured download size limit.');
    }

    // Consume the SDK stream incrementally. Do not call transformToByteArray()
    // or buffer an unbounded object before enforcing the maximum byte count.
    const bodyAny = response.Body as any;
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    if (bodyAny && typeof bodyAny[Symbol.asyncIterator] === 'function') {
      for await (const chunk of bodyAny) {
        const part = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
        totalBytes += part.length;
        if (totalBytes > maxStoredObjectBytes) {
          if (typeof bodyAny.destroy === 'function') bodyAny.destroy();
          throw new Error('Stored object exceeds the configured download size limit.');
        }
        chunks.push(part);
      }
    } else if (bodyAny && typeof bodyAny.transformToByteArray === 'function') {
      const byteArray = await bodyAny.transformToByteArray();
      if (byteArray.byteLength > maxStoredObjectBytes) {
        throw new Error('Stored object exceeds the configured download size limit.');
      }
      totalBytes = byteArray.byteLength;
      chunks.push(Buffer.from(byteArray));
    } else {
      throw new Error('Unsupported Backblaze object stream type.');
    }
    let buffer: Buffer<ArrayBufferLike> = Buffer.concat(chunks, totalBytes);

    // Decrypt application-encrypted private objects before any decompression.
    if (isPrivateB2Key(key)) {
      buffer = decryptPrivateB2Data(buffer);
    }

    // Bound object reads and decompression to avoid storage-based memory exhaustion.
    const maxPrivateObjectBytes = 32 * 1024 * 1024;
    if (buffer.length > maxPrivateObjectBytes + 64) {
      throw new Error('Stored object exceeds the configured download size limit.');
    }

    // If gzipped, decompress with a hard output cap. A failed decompression must
    // not silently return a compressed/invalid payload to a downstream parser.
    if (response.ContentEncoding === 'gzip' || key.endsWith('.gz')) {
      buffer = zlib.gunzipSync(buffer, { maxOutputLength: maxPrivateObjectBytes });
    }
    if (buffer.length > maxPrivateObjectBytes) {
      throw new Error('Decompressed object exceeds the configured download size limit.');
    }

    return {
      buffer,
      contentType: response.ContentType,
      contentEncoding: response.ContentEncoding,
    };
  } catch (err) {
    console.error('Backblaze private/public object download failed:', err instanceof Error ? err.name : 'unknown_error');
    return null;
  }
}

/**
 * Delete a file directly from Backblaze B2 bucket by key
 */
export async function deleteFromB2(key: string): Promise<boolean> {
  try {
    assertSafeB2ObjectKey(key);
    const config = getB2Config();
    const client = getB2Client();
    const command = new DeleteObjectCommand({
      Bucket: config.bucketName,
      Key: key,
    });
    await client.send(command);
    return true;
  } catch (err) {
    console.warn('Backblaze object deletion failed:', err instanceof Error ? err.name : 'unknown_error');
    return false;
  }
}

