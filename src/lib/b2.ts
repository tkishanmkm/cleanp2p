import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import sharp from 'sharp';
import zlib from 'zlib';

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

  const bucketName =
    process.env.B2_BUCKET_NAME ||
    process.env.AWS_BUCKET_NAME ||
    'thepax';

  const region =
    process.env.B2_BUCKET_REGION ||
    process.env.B2_REGION ||
    process.env.AWS_REGION ||
    'us-east-005';

  const rawEndpoint =
    process.env.B2_ENDPOINT ||
    process.env.AWS_ENDPOINT_URL ||
    'https://s3.us-east-005.backblazeb2.com';

  const endpoint = rawEndpoint.startsWith('http') ? rawEndpoint : `https://${rawEndpoint}`;

  return {
    keyId,
    applicationKey,
    bucketName,
    region,
    endpoint,
    isConfigured: Boolean(keyId && applicationKey && bucketName),
  };
}

/**
 * Returns an instantiated S3Client for Backblaze B2 using runtime env values.
 */
export function getB2Client(): S3Client {
  const config = getB2Config();

  return new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.keyId || 'dummy-key-id',
      secretAccessKey: config.applicationKey || 'dummy-app-key',
    },
    forcePathStyle: true,
  });
}

export const isB2Configured = () => getB2Config().isConfigured;
export const B2_BUCKET = process.env.B2_BUCKET_NAME || 'thepax';

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

// ==========================================
// BACKBLAZE B2 OPERATIONS
// ==========================================

/**
 * Uploads any buffer directly to Backblaze B2 using runtime env credentials
 */
export async function uploadToB2(
  key: string,
  buffer: Buffer,
  contentType: string,
  contentEncoding?: string
): Promise<{ key: string; publicUrl: string; bucket: string }> {
  const config = getB2Config();
  const client = getB2Client();

  const command = new PutObjectCommand({
    Bucket: config.bucketName,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    ContentEncoding: contentEncoding,
  });

  await client.send(command);

  const publicUrl = `${config.endpoint.replace(/\/+$/, '')}/${config.bucketName}/${key}`;

  return {
    key,
    publicUrl,
    bucket: config.bucketName,
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
    const compressedBuffer = await compressKycData(kycDetails);
    const key = `kyc-documents/${userId}/address_data_${Date.now()}.json.gz`;

    await uploadToB2(key, compressedBuffer, 'application/json', 'gzip');

    return { key, success: true };
  } catch (err) {
    console.error('Failed to save KYC address to B2:', err);
    return { key: '', success: false };
  }
}

/**
 * Generates presigned download URL for private KYC / Trade documents or avatars
 * Defaults to 24 hours (86400s) for media delivery
 */
export async function getPresignedDownloadUrl(
  key: string,
  expiresInSeconds = 86400
): Promise<string> {
  const config = getB2Config();
  const client = getB2Client();

  const command = new GetObjectCommand({
    Bucket: config.bucketName,
    Key: key,
  });

  return await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

/**
 * Downloads object from Backblaze B2 as a Buffer with automatic Gzip decompression
 */
export async function downloadFromB2(
  key: string
): Promise<{ buffer: Buffer; contentType?: string; contentEncoding?: string } | null> {
  try {
    const config = getB2Config();
    const client = getB2Client();

    const command = new GetObjectCommand({
      Bucket: config.bucketName,
      Key: key,
    });

    const response = await client.send(command);
    if (!response.Body) return null;

    let buffer: Buffer;
    const bodyAny = response.Body as any;

    if (typeof bodyAny.transformToByteArray === 'function') {
      const byteArray = await bodyAny.transformToByteArray();
      buffer = Buffer.from(byteArray);
    } else if (typeof bodyAny.pipe === 'function') {
      buffer = await new Promise<Buffer>((resolve, reject) => {
        const chunks: Buffer[] = [];
        bodyAny.on('data', (c: any) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
        bodyAny.on('error', reject);
        bodyAny.on('end', () => resolve(Buffer.concat(chunks)));
      });
    } else if (typeof bodyAny[Symbol.asyncIterator] === 'function') {
      const chunks: Uint8Array[] = [];
      for await (const chunk of bodyAny) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      buffer = Buffer.concat(chunks);
    } else {
      buffer = Buffer.from(bodyAny);
    }

    // If gzipped, decompress
    if (response.ContentEncoding === 'gzip' || key.endsWith('.gz')) {
      try {
        buffer = zlib.gunzipSync(buffer);
      } catch (gunzipErr) {
        console.warn('Gunzip decompression error, returning raw buffer:', gunzipErr);
      }
    }

    return {
      buffer,
      contentType: response.ContentType,
      contentEncoding: response.ContentEncoding,
    };
  } catch (err) {
    console.error('downloadFromB2 error for key', key, ':', err);
    return null;
  }
}

/**
 * Delete a file directly from Backblaze B2 bucket by key
 */
export async function deleteFromB2(key: string): Promise<boolean> {
  try {
    const config = getB2Config();
    const client = getB2Client();
    const command = new DeleteObjectCommand({
      Bucket: config.bucketName,
      Key: key,
    });
    await client.send(command);
    return true;
  } catch (err) {
    console.warn('deleteFromB2 error for key', key, ':', err);
    return false;
  }
}

