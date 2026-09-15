import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { uploadToB2, compressTradeMedia } from '@/lib/b2';

export const dynamic = 'force-dynamic';

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
    const rawBuffer = Buffer.from(arrayBuffer);

    // Compress Trade Media (Images & Documents)
    const {
      buffer: finalBuffer,
      contentType: finalContentType,
      fileName: finalFileName,
      isCompressed,
    } = await compressTradeMedia(rawBuffer, fileType || 'application/octet-stream', file.name);

    // Sanitize file name
    const sanitizedName = finalFileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const key = `trades/${tradeId}/${Date.now()}_${sanitizedName}`;

    // Upload directly to Backblaze B2
    const b2Upload = await uploadToB2(key, finalBuffer, finalContentType);

    // Provide proxied stream URL or B2 direct URL
    const proxyUrl = `/api/trade/media?key=${encodeURIComponent(key)}`;

    return NextResponse.json({
      success: true,
      url: proxyUrl,
      publicUrl: b2Upload.publicUrl,
      key,
      mediaType,
      fileName: finalFileName,
      originalSize: file.size,
      compressedSize: finalBuffer.length,
      isCompressed,
      visibility,
    });
  } catch (err: any) {
    console.error('B2 trade media upload error:', err);
    return NextResponse.json(
      { error: err.message || 'Failed to upload media to Backblaze B2' },
      { status: 500 }
    );
  }
}
