import { NextRequest, NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';

const b2Endpoint = process.env.B2_ENDPOINT || 'https://s3.us-east-005.backblazeb2.com';
const b2Region = process.env.B2_REGION || 'us-east-005';
const b2AccessKeyId = process.env.B2_ACCESS_KEY_ID || process.env.B2_KEY_ID || '0056c3cfd0f3f020000000001';
const b2SecretAccessKey = process.env.B2_SECRET_ACCESS_KEY || process.env.B2_APP_KEY || 'K0050OvwcFMBcdIqGMNBFYB0UNjWCwY';
const b2Bucket = process.env.B2_BUCKET_NAME || 'thepax';

const s3Client = new S3Client({
  endpoint: b2Endpoint,
  region: b2Region,
  credentials: {
    accessKeyId: b2AccessKeyId,
    secretAccessKey: b2SecretAccessKey,
  },
  forcePathStyle: true,
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    let key = searchParams.get('key');
    const urlParam = searchParams.get('url');
    const download = searchParams.get('download') === 'true';

    if (!key && urlParam) {
      // Extract key from URL
      try {
        const parsed = new URL(urlParam);
        const parts = parsed.pathname.split(`/${b2Bucket}/`);
        if (parts.length > 1) {
          key = parts[1];
        } else {
          key = parsed.pathname.replace(/^\//, '');
        }
      } catch {
        key = urlParam.replace(/^[a-z]+:\/\/[^/]+\//i, '');
      }
    }

    if (!key) {
      return NextResponse.json({ error: 'Key or URL parameter is required' }, { status: 400 });
    }

    // Clean leading slash
    key = key.replace(/^\//, '');

    const command = new GetObjectCommand({
      Bucket: b2Bucket,
      Key: key,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      return NextResponse.json({ error: 'File body not found' }, { status: 404 });
    }

    const contentType = response.ContentType || 'application/octet-stream';
    const filename = key.split('/').pop() || 'trade-media';

    // Convert stream to array buffer
    const streamToBuffer = async (stream: any): Promise<Buffer> => {
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      return Buffer.concat(chunks);
    };

    const buffer = await streamToBuffer(response.Body);

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': buffer.length.toString(),
      'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
    };

    if (download) {
      headers['Content-Disposition'] = `attachment; filename="${filename}"`;
    } else {
      headers['Content-Disposition'] = `inline; filename="${filename}"`;
    }

    return new NextResponse(buffer, {
      status: 200,
      headers,
    });
  } catch (error: any) {
    console.error('Error fetching trade media proxy:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to retrieve media file' },
      { status: 500 }
    );
  }
}
