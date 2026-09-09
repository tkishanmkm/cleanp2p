import { NextRequest, NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@/lib/supabase/server';

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

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const tradeId = (formData.get('tradeId') as string) || '';
    const senderId = (formData.get('senderId') as string) || '';
    const visibility = (formData.get('visibility') as string) || 'all'; // 'all' | 'moderator_only'

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!tradeId) {
      return NextResponse.json({ error: 'Trade ID is required' }, { status: 400 });
    }

    const fileType = file.type || '';
    let mediaType: 'image' | 'video' | 'document' = 'document';
    if (fileType.startsWith('image/')) mediaType = 'image';
    else if (fileType.startsWith('video/')) mediaType = 'video';
    else mediaType = 'document';

    // Rule: Max video size 30 MB
    const MAX_VIDEO_SIZE = 30 * 1024 * 1024; // 30 MB
    if (mediaType === 'video' && file.size > MAX_VIDEO_SIZE) {
      return NextResponse.json(
        { error: 'Video size exceeds the 30 MB limit. Please compress or trim the video.' },
        { status: 400 }
      );
    }

    // Rule: Limit 3 documents, 3 images, 3 videos per trade
    // Count existing media for this trade in trade_messages via Supabase
    const supabase = await createClient();
    const { data: existingMessages } = await supabase
      .from('trade_messages')
      .select('media_type, media_url')
      .eq('trade_id', tradeId)
      .eq('sender_id', senderId)
      .not('media_url', 'is', null);

    if (existingMessages) {
      const typeCount = existingMessages.filter(
        (m: any) => m.media_type === mediaType
      ).length;

      if (typeCount >= 3) {
        return NextResponse.json(
          {
            error: `Maximum limit of 3 ${mediaType}s per user has been reached for this trade.`,
          },
          { status: 400 }
        );
      }
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Sanitize file name
    const sanitizedName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `trades/${tradeId}/${Date.now()}_${sanitizedName}`;

    // Upload to Backblaze B2
    const uploadCommand = new PutObjectCommand({
      Bucket: b2Bucket,
      Key: key,
      Body: buffer,
      ContentType: fileType || 'application/octet-stream',
    });

    await s3Client.send(uploadCommand);

    // Construct public / direct B2 URL
    const publicUrl = `${b2Endpoint}/${b2Bucket}/${key}`;

    return NextResponse.json({
      success: true,
      url: publicUrl,
      key,
      mediaType,
      fileName: file.name,
      fileSize: file.size,
      visibility,
    });
  } catch (err: any) {
    console.error('B2 upload error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to upload media to Backblaze B2' },
      { status: 500 }
    );
  }
}
