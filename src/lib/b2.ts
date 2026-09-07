import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const B2_ENDPOINT = process.env.B2_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com';
const B2_REGION = process.env.B2_REGION || 'us-east-005';
const B2_ACCESS_KEY_ID = process.env.B2_ACCESS_KEY_ID || '0056c3cfd0f3f020000000001';
const B2_SECRET_ACCESS_KEY = process.env.B2_SECRET_ACCESS_KEY || 'K0050OvwcFMBcdIqGMNBFYB0UNjWCwY';
export const B2_BUCKET = process.env.B2_BUCKET_NAME || 'thepax';

let _s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!_s3Client) {
    _s3Client = new S3Client({
      endpoint: B2_ENDPOINT,
      region: B2_REGION,
      credentials: {
        accessKeyId: B2_ACCESS_KEY_ID,
        secretAccessKey: B2_SECRET_ACCESS_KEY,
      },
    });
  }
  return _s3Client;
}

export function isB2Configured(): boolean {
  return Boolean(B2_ACCESS_KEY_ID && B2_SECRET_ACCESS_KEY && B2_BUCKET);
}

/**
 * Uploads raw buffer to Backblaze B2 (Private Bucket)
 */
export async function uploadToB2(
  key: string,
  buffer: Buffer,
  contentType: string
): Promise<string> {
  const client = getS3Client();
  const command = new PutObjectCommand({
    Bucket: B2_BUCKET,
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await client.send(command);
  return key;
}

/**
 * Generates a short-lived presigned download URL (e.g., 15 minutes) for private trade files/media
 */
export async function getPresignedDownloadUrl(key: string, expiresInSeconds = 900): Promise<string> {
  const client = getS3Client();
  const command = new GetObjectCommand({
    Bucket: B2_BUCKET,
    Key: key,
  });

  return await getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

/**
 * Downloads object from Backblaze B2 as a Buffer
 */
export async function downloadFromB2(key: string): Promise<{ buffer: Buffer; contentType?: string } | null> {
  try {
    const client = getS3Client();
    const command = new GetObjectCommand({
      Bucket: B2_BUCKET,
      Key: key,
    });

    const response = await client.send(command);
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
