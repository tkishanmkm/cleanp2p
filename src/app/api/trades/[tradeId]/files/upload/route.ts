import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { uploadToB2, isB2Configured } from '@/lib/b2';

async function getSharpInstance() {
  try {
    const sharpModule = await import('sharp');
    return (sharpModule as any).default || sharpModule;
  } catch {
    return null;
  }
}

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  context: { params: { tradeId: string } | Promise<{ tradeId: string }> }
) {
  try {
    const rawParams = await Promise.resolve(context.params);
    const tradeId = rawParams.tradeId;

    const supabase = await createClient();
    const adminSupabase = getSupabaseAdminClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = user.id;

    // Verify participant in trades or p2p_trades
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId);
    let trade: any = null;

    if (isUuid) {
      const { data } = await adminSupabase
        .from('trades')
        .select('id, buyer_id, seller_id')
        .eq('id', tradeId)
        .maybeSingle();
      trade = data;
    }

    if (!trade) {
      const { data } = await adminSupabase
        .from('trades')
        .select('id, buyer_id, seller_id')
        .or(`trade_id.eq.${tradeId},public_id.eq.${tradeId}`)
        .maybeSingle();
      trade = data;
    }

    if (!trade && isUuid) {
      const { data } = await adminSupabase
        .from('p2p_trades')
        .select('id, buyer_id, seller_id')
        .eq('id', tradeId)
        .maybeSingle();
      trade = data;
    }

    const { data: profile } = await adminSupabase
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();
    const isAdmin = profile?.role === 'admin' || profile?.role === 'moderator';

    if (!trade || (!isAdmin && trade.buyer_id !== userId && trade.seller_id !== userId)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const actualTradeId = trade.id;

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

      const { data: newLink, error } = await adminSupabase
        .from('trade_files')
        .insert({
          trade_id: actualTradeId,
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

      // Record message in trade_messages
      try {
        await adminSupabase.from('trade_messages').insert({
          trade_id: actualTradeId,
          sender_id: userId,
          message: `Shared cloud link: ${externalUrl}`,
          file_url: externalUrl,
          attachment_url: externalUrl,
        });
      } catch (msgErr) {
        // non-fatal
      }

      return NextResponse.json({
        success: true,
        file: newLink || {
          trade_id: actualTradeId,
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

    // Size limit checks
    if (fileType === 'video' && file.size > 30 * 1024 * 1024) {
      return NextResponse.json(
        {
          error: 'Video exceeds 30 MB limit. Compress your file or share via Google Drive/Dropbox.',
        },
        { status: 400 }
      );
    }

    if (fileType === 'image' && file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        {
          error: 'Image exceeds 10 MB limit. Please select a smaller photo or screenshot.',
        },
        { status: 400 }
      );
    }

    if (fileType === 'document' && file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        {
          error: 'Document exceeds 10 MB limit. Please upload a smaller document.',
        },
        { status: 400 }
      );
    }

    // Quota verification: Check existing count (allow generous limit)
    const { count } = await adminSupabase
      .from('trade_files')
      .select('*', { count: 'exact', head: true })
      .eq('trade_id', actualTradeId)
      .eq('uploaded_by', userId)
      .eq('file_type', fileType);

    if ((count || 0) >= 10) {
      return NextResponse.json(
        {
          error: 'LIMIT_REACHED',
          message: `Your upload limit for ${fileType}s (10/10) has been reached. You can share your file using a Dropbox or Google Drive link instead.`,
        },
        { status: 429 }
      );
    }

    let fileExt = file.name.split('.').pop() || 'bin';
    let mimeType = file.type;

    const arrayBuffer = await file.arrayBuffer();
    let uploadBuffer = Buffer.from(arrayBuffer);

    // Watermark processing for images
    if (fileType === 'image') {
      try {
        const timestamp = new Date().toISOString();
        const watermarkSvg = `
          <svg width="800" height="160" xmlns="http://www.w3.org/2000/svg">
            <style>
              .title { fill: rgba(239, 68, 68, 0.9); font-size: 24px; font-weight: bold; font-family: sans-serif; }
              .sub { fill: rgba(255, 255, 255, 0.9); font-size: 16px; font-family: sans-serif; }
            </style>
            <rect width="100%" height="100%" fill="rgba(0,0,0,0.5)" rx="6" />
            <text x="20" y="45" class="title">PAXONES TRADE PROOF</text>
            <text x="20" y="85" class="sub">Trade ID: ${tradeId}</text>
            <text x="20" y="120" class="sub">Time: ${timestamp}</text>
          </svg>
        `;

        const sharp = await getSharpInstance();
        if (sharp) {
          uploadBuffer = await sharp(uploadBuffer)
            .resize(1600, 1600, { fit: 'inside', withoutEnlargement: true })
            .composite([{ input: Buffer.from(watermarkSvg), gravity: 'southeast' }])
            .jpeg({ quality: 88 })
            .toBuffer();

          fileExt = 'jpg';
          mimeType = 'image/jpeg';
        }
      } catch (watermarkErr) {
        console.warn('Watermark processing bypassed:', watermarkErr);
      }
    }

    const objectKey = `trades/${actualTradeId}/${fileType}s/proof_${Date.now()}.${fileExt}`;
    let publicUrl: string | null = null;

    // 1. If Backblaze B2 is configured, upload to B2
    if (isB2Configured()) {
      try {
        await uploadToB2(objectKey, uploadBuffer, mimeType);
      } catch (b2Err) {
        console.warn('B2 upload skipped:', b2Err);
      }
    }

    // 2. Upload to Supabase Storage 'trade-attachments'
    try {
      const storagePath = `${actualTradeId}/${userId}_${Date.now()}.${fileExt}`;
      const { error: sbStorageErr } = await adminSupabase.storage
        .from('trade-attachments')
        .upload(storagePath, uploadBuffer, {
          contentType: mimeType,
          upsert: true,
        });

      if (!sbStorageErr) {
        const { data: pubData } = adminSupabase.storage.from('trade-attachments').getPublicUrl(storagePath);
        publicUrl = pubData.publicUrl;
      } else {
        console.warn('Supabase storage upload warning:', sbStorageErr);
      }
    } catch (sbErr) {
      console.error('Supabase storage upload error:', sbErr);
    }

    // Fallback URL if public URL not yet generated
    const fileAccessUrl = publicUrl || `/api/trades/${actualTradeId}/files/latest`;

    // 3. Save metadata in trade_files
    const { data: savedFile, error: dbError } = await adminSupabase
      .from('trade_files')
      .insert({
        trade_id: actualTradeId,
        uploaded_by: userId,
        file_type: fileType,
        file_name: file.name,
        object_key: objectKey,
        file_size: uploadBuffer.length,
        mime_type: mimeType,
        external_url: publicUrl || null,
      })
      .select()
      .maybeSingle();

    if (dbError) {
      console.warn('trade_files insert warning:', dbError);
    }

    // 4. Post to trade chat messages so both buyer and seller see it in real-time
    try {
      await adminSupabase.from('trade_messages').insert({
        trade_id: actualTradeId,
        sender_id: userId,
        message: `📎 Uploaded payment proof attachment: ${file.name}`,
        file_url: fileAccessUrl,
        attachment_url: fileAccessUrl,
      });
    } catch (chatErr) {
      // non-fatal
    }

    return NextResponse.json({
      success: true,
      file_url: fileAccessUrl,
      file: savedFile || {
        trade_id: actualTradeId,
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
