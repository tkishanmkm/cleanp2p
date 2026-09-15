import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { getB2Client, getB2Config } from '@/lib/b2';
import zlib from 'zlib';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const config = getB2Config();
    const b2Bucket = config.bucketName;
    const s3Client = getB2Client();

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

    // Convert stream to buffer
    const stream = response.Body as any;
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    let buffer = Buffer.concat(chunks);

    // Auto-decompress if stored as gzipped and requested as standard preview
    if (response.ContentEncoding === 'gzip' || key.endsWith('.gz')) {
      try {
        buffer = zlib.gunzipSync(buffer);
      } catch (gunzipErr) {
        console.warn('Gunzip error during proxy stream:', gunzipErr);
      }
    }

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
