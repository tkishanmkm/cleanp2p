import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

let _s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!_s3Client) {
    _s3Client = new S3Client({
      endpoint: process.env.B2_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com',
      region: process.env.B2_REGION || 'us-east-005',
      credentials: {
        accessKeyId: process.env.B2_KEY_ID || process.env.B2_ACCESS_KEY_ID || 'dummy-key-id',
        secretAccessKey: process.env.B2_APPLICATION_KEY || process.env.B2_SECRET_ACCESS_KEY || 'dummy-secret-key',
      },
    });
  }
  return _s3Client;
}

export const B2_BUCKET = process.env.B2_BUCKET_NAME || 'thepax';

export function isB2Configured(): boolean {
  const keyId = process.env.B2_KEY_ID || process.env.B2_ACCESS_KEY_ID;
  const appKey = process.env.B2_APPLICATION_KEY || process.env.B2_SECRET_ACCESS_KEY;
  return Boolean(keyId && appKey && B2_BUCKET);
}

/**
 * Returns a presigned GET url for an avatar by public username
 */
export async function getAvatarSignedUrl(username: string) {
  const command = new GetObjectCommand({
    Bucket: B2_BUCKET,
    Key: `avatars/${username.toLowerCase()}.png`,
  });
  return await getSignedUrl(getS3Client(), command, { expiresIn: 3600 });
}

/**
 * Generates presigned PUT url for direct client uploads
 */
export async function getUploadPresignedUrl(key: string, contentType: string) {
  const command = new PutObjectCommand({
    Bucket: B2_BUCKET,
    Key: key,
    ContentType: contentType,
  });
  return await getSignedUrl(getS3Client(), command, { expiresIn: 900 });
}

/**
 * Uploads raw buffer to Backblaze B2
 */
export async function uploadToB2(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: B2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await getS3Client().send(command);
  return key;
}

/**
 * Generates a short-lived presigned download URL for private files/attachments
 */
export async function getPresignedDownloadUrl(key: string, expiresInSeconds = 900): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: B2_BUCKET,
    Key: key,
  });

  return await getSignedUrl(getS3Client(), command, { expiresIn: expiresInSeconds });
}

/**
 * Downloads object from Backblaze B2 as a Buffer
 */
export async function downloadFromB2(key: string): Promise<{ buffer: Buffer; contentType?: string } | null> {
  try {
    const command = new GetObjectCommand({
      Bucket: B2_BUCKET,
      Key: key,
    });

    const response = await getS3Client().send(command);
    if (!response.Body) return null;

    const stream = response.Body as any;
    const chunks: Uint8Array[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    return {
      buffer: Buffer.concat(chunks),
      contentType: response.ContentType,
    };
  } catch (err) {
    console.error('downloadFromB2 error:', err);
    return null;
  }
}

