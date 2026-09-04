import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { uploadToB2 } from '@/lib/b2';
import sharp from 'sharp';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  context: { params: { tradeId: string } | Promise<{ tradeId: string }> }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const tradeId = rawParams.tradeId;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.id;

    // Verify participant in p2p_trades or trades
    let { data: trade } = await supabase
      .from('p2p_trades')
      .select('id, buyer_id, seller_id')
      .eq('id', tradeId)
      .maybeSingle();

    if (!trade) {
      const { data: altTrade } = await supabase
        .from('trades')
        .select('id, buyer_id, seller_id')
        .eq('id', tradeId)
        .maybeSingle();
      trade = altTrade;
    }

    if (!trade || (trade.buyer_id !== userId && trade.seller_id !== userId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    const externalUrl = formData.get('externalUrl') as string | null;

    // Handle External Cloud Links (Dropbox, Google Drive, OneDrive)
    if (externalUrl) {
      const isValidCloudLink = /^(https?:\/\/)?(www\.)?(dropbox\.com|drive\.google\.com|onedrive\.live\.com)\/.*$/i.test(externalUrl);

      if (!isValidCloudLink) {
        return NextResponse.json(
          { error: 'Only Dropbox, Google Drive, and OneDrive links are accepted.' },
          { status: 400 }
        );
      }

      const { data: newLink, error } = await supabase
        .from('trade_files')
        .insert({
          trade_id: tradeId,
          uploaded_by: userId,
          file_type: 'document',
          file_name: 'External Cloud Link',
          object_key: `external-${Date.now()}`,
          file_size: 0,
          mime_type: 'text/html',
          is_external_link: true,
          external_url: externalUrl,
        })
        .select()
        .maybeSingle();

      if (error) {
        console.warn('trade_files table insert error:', error);
      }

      // Also record message in trade_messages/trade_chat_messages if possible
      try {
        await supabase.from('trade_messages').insert({
          trade_id: tradeId,
          sender_id: userId,
          message: `Shared cloud link: ${externalUrl}`,
          file_url: externalUrl,
        });
      } catch (msgErr) {
        // non-fatal
      }

      return NextResponse.json({
        success: true,
        file: newLink || {
          trade_id: tradeId,
          uploaded_by: userId,
          file_type: 'document',
          file_name: 'External Cloud Link',
          external_url: externalUrl,
          is_external_link: true,
        },
        warning: 'PHISHING WARNING: Verify link authenticity before opening.',
      });
    }

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    // Classify file type
    let fileType: 'image' | 'document' | 'video';
    if (file.type.startsWith('image/')) fileType = 'image';
    else if (file.type.startsWith('video/')) fileType = 'video';
    else fileType = 'document';

    // Video limit check
    if (fileType === 'video' && file.size > 30 * 1024 * 1024) {
      return NextResponse.json(
        {
          error: 'Video exceeds 30 MB limit. Compress your file or share via Google Drive/Dropbox.',
        },
        { status: 400 }
      );
    }

    // Quota verification: Check existing count
    const { count } = await supabase
      .from('trade_files')
      .select('*', { count: 'exact', head: true })
      .eq('trade_id', tradeId)
      .eq('uploaded_by', userId)
      .eq('file_type', fileType);

    if ((count || 0) >= 3) {
      return NextResponse.json(
        {
          error: 'LIMIT_REACHED',
          message: `Your upload limit for ${fileType}s (3/3) has been reached. You can share your file using a Dropbox/Cloud Storage or Google Drive link instead.`,
        },
        { status: 429 }
      );
    }

    // Generate path structure: trades/{trade_id}/chat/{type}s/msg_{timestamp}.{ext}
    let fileExt = file.name.split('.').pop() || 'bin';
    let mimeType = file.type;

    const arrayBuffer = await file.arrayBuffer();
    let uploadBuffer = Buffer.from(arrayBuffer);

    // Apply SVG Watermark Overlay via Sharp for images
    if (fileType === 'image') {
      try {
        const timestamp = new Date().toISOString();
        const watermarkSvg = `
          <svg width="800" height="200" xmlns="http://www.w3.org/2000/svg">
            <style>
              .title { fill: rgba(239, 68, 68, 0.85); font-size: 28px; font-weight: bold; font-family: sans-serif; }
              .sub { fill: rgba(255, 255, 255, 0.9); font-size: 18px; font-family: sans-serif; }
            </style>
            <rect width="100%" height="100%" fill="rgba(0,0,0,0.45)" rx="8" />
            <text x="20" y="50" class="title">OFFICIAL ESCROW PROOF ATTACHMENT</text>
            <text x="20" y="90" class="sub">Trade ID: ${tradeId}</text>
            <text x="20" y="120" class="sub">Uploader UID: ${userId}</text>
            <text x="20" y="150" class="sub">Stamped At: ${timestamp}</text>
          </svg>
        `;

        uploadBuffer = await sharp(uploadBuffer)
          .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
          .composite([{ input: Buffer.from(watermarkSvg), gravity: 'southeast' }])
          .jpeg({ quality: 85 })
          .toBuffer();

        fileExt = 'jpg';
        mimeType = 'image/jpeg';
      } catch (watermarkErr) {
        console.warn('Watermark processing failed, uploading original buffer:', watermarkErr);
      }
    }

    const objectKey = `trades/${tradeId}/chat/${fileType}s/msg_${Date.now()}.${fileExt}`;

    // Upload to Backblaze B2 (and fallback Supabase storage if needed)
    let publicUrl: string | null = null;
    try {
      await uploadToB2(objectKey, uploadBuffer, mimeType);
    } catch (b2Err: any) {
      console.warn('B2 upload failed, attempting Supabase storage fallback:', b2Err);
      try {
        const fallbackPath = `${tradeId}/${userId}_${Date.now()}.${fileExt}`;
        const { error: sbStorageErr } = await supabase.storage
          .from('trade-attachments')
          .upload(fallbackPath, uploadBuffer, {
            contentType: mimeType,
            upsert: true,
          });
        if (!sbStorageErr) {
          const { data: pubData } = supabase.storage.from('trade-attachments').getPublicUrl(fallbackPath);
          publicUrl = pubData.publicUrl;
        }
      } catch (sbErr) {
        console.error('Supabase storage fallback error:', sbErr);
      }
    }

    // Save metadata in trade_files
    const { data: savedFile, error: dbError } = await supabase
      .from('trade_files')
      .insert({
        trade_id: tradeId,
        uploaded_by: userId,
        file_type: fileType,
        file_name: file.name,
        object_key: objectKey,
        file_size: file.size,
        mime_type: file.type,
      })
      .select()
      .maybeSingle();

    if (dbError) {
      console.warn('trade_files insert warning:', dbError);
    }

    // Post to trade chat messages as well so participants see the attached file in real time
    const fileAccessUrl = publicUrl || `/api/trades/${tradeId}/files/${savedFile?.id || 'latest'}`;
    try {
      await supabase.from('trade_messages').insert({
        trade_id: tradeId,
        sender_id: userId,
        content: `📎 Uploaded verified ${fileType} proof attachment.`,
        message: `Uploaded ${fileType}: ${file.name}`,
        file_url: fileAccessUrl,
        is_system_message: false,
      });
    } catch (chatErr) {
      // non-fatal
    }

    return NextResponse.json({
      success: true,
      file_url: fileAccessUrl,
      file: savedFile || {
        trade_id: tradeId,
        uploaded_by: userId,
        file_type: fileType,
        file_name: file.name,
        object_key: objectKey,
        file_size: uploadBuffer.length,
        mime_type: mimeType,
      },
    });
  } catch (err: any) {
    console.error('Error handling trade file upload:', err);
    return NextResponse.json({ error: err.message || 'Failed to upload trade file' }, { status: 500 });
  }
}
