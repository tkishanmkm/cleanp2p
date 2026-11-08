import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';
import { getSupabaseAdminClient } from '@/lib/supabase/server';
import { uploadToB2, deleteFromB2, isB2Configured } from '@/lib/b2';

async function getSharpInstance() {
  try {
    const sharpModule = await import('sharp');
    return (sharpModule as any).default || sharpModule;
  } catch {
    return null;
  }
}

export const dynamic = 'force-dynamic';

const MAX_TRADE_FILE_REQUEST_BYTES = 34 * 1024 * 1024;

async function readBoundedRequestBody(req: Request): Promise<Uint8Array | null> {
  const reader = req.body?.getReader();
  if (!reader) return new Uint8Array();

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_TRADE_FILE_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ tradeId: string }> }
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

    if (!trade && !isUuid) {
      // Do not interpolate a path parameter into PostgREST .or() syntax.
      // A public trade identifier is a single bounded opaque token, and each
      // possible lookup uses a typed equality filter.
      if (!/^[A-Za-z0-9_-]{3,80}$/.test(tradeId)) {
        return NextResponse.json({ error: 'Invalid trade identifier.' }, { status: 400 });
      }
      const { data: byTradeId, error: tradeIdError } = await adminSupabase
        .from('trades')
        .select('id, buyer_id, seller_id')
        .eq('trade_id', tradeId)
        .maybeSingle();
      if (tradeIdError) {
        return NextResponse.json({ error: 'Unable to verify trade access. Please try again later.' }, { status: 503 });
      }
      trade = byTradeId;
      if (!trade) {
        const { data: byPublicId, error: publicIdError } = await adminSupabase
          .from('trades')
          .select('id, buyer_id, seller_id')
          .eq('public_id', tradeId)
          .maybeSingle();
        if (publicIdError) {
          return NextResponse.json({ error: 'Unable to verify trade access. Please try again later.' }, { status: 503 });
        }
        trade = byPublicId;
      }
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

    // Preflight only: the database trigger is the authoritative concurrent-send guard.
    const [messageCount, legacyMessageCount] = await Promise.all([
      adminSupabase.from('trade_messages').select('id', { count: 'exact', head: true }).eq('trade_id', trade.id).eq('sender_id', userId),
      adminSupabase.from('trade_chat_messages').select('id', { count: 'exact', head: true }).eq('trade_id', trade.id).eq('sender_id', userId),
    ]);
    if (messageCount.error || legacyMessageCount.error) {
      return NextResponse.json({ error: 'Unable to verify your trade chat limit. Please try again later.' }, { status: 503 });
    }
    if ((messageCount.count || 0) + (legacyMessageCount.count || 0) >= 100) {
      return NextResponse.json({
        error: 'TRADE_CHAT_LIMIT_REACHED',
        message: `You have reached your 100-message limit for this trade. Contact support@wayones.com with Trade ID ${trade.id} and explain what moderators should review.`,
      }, { status: 429 });
    }

    // Reject oversized multipart requests before parsing the body; individual files are capped below.
    const contentLengthHeader = req.headers.get('content-length');
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : null;
    if (contentLength !== null && (!Number.isFinite(contentLength) || contentLength > 34 * 1024 * 1024)) {
      return NextResponse.json({ error: 'Upload request is too large. Each file can be up to 32 MB.' }, { status: 413 });
    }

    // Stream-cap the multipart body as well as the individual file size.
    // Content-Length is only an early-reject hint and can be absent on chunked requests.
    const requestBytes = await readBoundedRequestBody(req);
    if (requestBytes === null) {
      return NextResponse.json({ error: 'Upload request is too large. Each file can be up to 32 MB.' }, { status: 413 });
    }
    const multipartHeaders = new Headers(req.headers);
    multipartHeaders.delete('content-length');
    let formData: FormData;
    try {
      // Construct a fresh ArrayBuffer so this remains a valid BodyInit across
      // Node 20/22/24 TypeScript DOM/Buffer generic definitions.
      const multipartBody = new ArrayBuffer(requestBytes.byteLength);
      new Uint8Array(multipartBody).set(requestBytes);
      const boundedRequest = new Request(req.url, {
        method: 'POST',
        headers: multipartHeaders,
        body: multipartBody,
      });
      formData = await boundedRequest.formData();
    } catch {
      return NextResponse.json({ error: 'Malformed multipart upload request.' }, { status: 400 });
    }

    const fileValue = formData.get('file');
    const file = fileValue instanceof File ? fileValue : null;
    const externalUrlValue = formData.get('externalUrl');
    if (externalUrlValue !== null && typeof externalUrlValue !== 'string') {
      return NextResponse.json({ error: 'Invalid external link field.' }, { status: 400 });
    }
    const externalUrl = typeof externalUrlValue === 'string' ? externalUrlValue.trim() : null;
    if (externalUrl && externalUrl.length > 2048) {
      return NextResponse.json({ error: 'Cloud-storage links must be 2,048 characters or fewer.' }, { status: 400 });
    }

    // Handle External Cloud Links (Dropbox, Google Drive, OneDrive)
    if (externalUrl) {
      let parsedExternalUrl: URL;
      try {
        parsedExternalUrl = new URL(externalUrl);
      } catch {
        return NextResponse.json({ error: 'Please provide a valid cloud-storage HTTPS link.' }, { status: 400 });
      }
      const allowedHosts = new Set(['dropbox.com', 'www.dropbox.com', 'drive.google.com', 'onedrive.live.com', 'www.onedrive.live.com']);
      const isValidCloudLink = parsedExternalUrl.protocol === 'https:' && allowedHosts.has(parsedExternalUrl.hostname.toLowerCase()) && !parsedExternalUrl.username && !parsedExternalUrl.password && (parsedExternalUrl.port === '' || parsedExternalUrl.port === '443');

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

      if (error || !newLink) {
        console.error('Trade cloud-link metadata insert failed:', error?.code || 'no_record_returned');
        return NextResponse.json({ error: 'Could not save the cloud-link attachment record. Please try again.' }, { status: 503 });
      }

      // Record message in trade_messages; never report a complete chat share if it failed.
      const { error: chatError } = await adminSupabase.from('trade_messages').insert({
        trade_id: actualTradeId,
        sender_id: userId,
        message: `Shared cloud link: ${externalUrl}`,
        file_url: externalUrl,
        attachment_url: externalUrl,
      });
      if (chatError) {
        console.error('Trade link chat insert rejected:', chatError.code || 'unknown');
        const { error: rollbackError } = await adminSupabase.from('trade_files').delete().eq('id', newLink.id).eq('trade_id', actualTradeId).eq('uploaded_by', userId);
        if (rollbackError) console.error('Trade cloud-link metadata rollback failed:', rollbackError.code || 'unknown');
        return NextResponse.json({
          error: 'The cloud link could not be posted to chat. Please retry.',
          code: chatError.code === 'P0001' ? 'TRADE_CHAT_LIMIT_REACHED' : 'TRADE_CHAT_INSERT_FAILED',
        }, { status: chatError.code === 'P0001' ? 429 : 503 });
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
      return NextResponse.json({ error: 'A file or supported cloud-storage link is required.' }, { status: 400 });
    }

    // Classify file type
    let fileType: 'image' | 'document' | 'video';
    if (file.type.startsWith('image/')) fileType = 'image';
    else if (file.type.startsWith('video/')) fileType = 'video';
    else fileType = 'document';

    // Every individual uploaded file may be up to 32 MiB, regardless of media type.
    if (file.size > 32 * 1024 * 1024) {
      return NextResponse.json(
        {
          error: 'FILE_SIZE_LIMIT_EXCEEDED',
          message: 'Each file can be up to 32 MB. Compress it or share it through Google Drive or Dropbox instead.',
          alternatives: ['Google Drive', 'Dropbox'],
        },
        { status: 413 }
      );
    }

    // External cloud links remain available after the binary-file quota is reached.
    if (!externalUrl) {
      const { count, error: quotaError } = await adminSupabase
        .from('trade_files')
        .select('id', { count: 'exact', head: true })
        .eq('trade_id', actualTradeId)
        .eq('uploaded_by', userId)
        .eq('file_type', fileType)
        .or('is_external_link.is.null,is_external_link.eq.false');

      if (quotaError) {
        return NextResponse.json({ error: 'Unable to verify your trade attachment limit. Please try again later.' }, { status: 503 });
      }

      if ((count || 0) >= 3) {
        return NextResponse.json(
          {
            error: 'TRADE_MEDIA_LIMIT_REACHED',
            mediaType: fileType,
            limit: 3,
            message: `You have reached the limit of 3 ${fileType}s for this trade. To share more files, use Google Drive or Dropbox and submit the share link instead.`,
            alternatives: ['Google Drive', 'Dropbox'],
          },
          { status: 429 }
        );
      }
    }

    const safeFileName = file.name.replace(/[\\r\\n\\0]/g, '_').slice(0, 180) || 'trade-attachment';
    const candidateExtension = safeFileName.split('.').pop()?.toLowerCase() || 'bin';
    let fileExt = /^[a-z0-9]{1,10}$/.test(candidateExtension) ? candidateExtension : 'bin';
    let mimeType = String(file.type || 'application/octet-stream').slice(0, 128);

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
            <text x="20" y="45" class="title">Wayones TRADE PROOF</text>
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

    // Trade evidence must be served through the authenticated proxy, never a public bucket URL.
    if (!isB2Configured()) {
      return NextResponse.json({ error: 'Private trade storage is unavailable. Please try again later.' }, { status: 503 });
    }
    try {
      await uploadToB2(objectKey, uploadBuffer, mimeType);
    } catch (storageError) {
      console.error('Private trade storage upload failed:', storageError);
      return NextResponse.json({ error: 'Unable to store trade evidence securely. Please try again later.' }, { status: 503 });
    }

    const fileAccessUrl = `/api/trade/media?key=${encodeURIComponent(objectKey)}`;

    // 3. Save metadata in trade_files
    const { data: savedFile, error: dbError } = await adminSupabase
      .from('trade_files')
      .insert({
        trade_id: actualTradeId,
        uploaded_by: userId,
        file_type: fileType,
        file_name: safeFileName,
        object_key: objectKey,
        file_size: uploadBuffer.length,
        mime_type: mimeType,
        external_url: null,
      })
      .select()
      .maybeSingle();

    if (dbError || !savedFile) {
      console.error('Trade attachment metadata insert failed:', dbError?.code || 'no_record_returned');
      const deleted = await deleteFromB2(objectKey);
      if (!deleted) console.error('Private trade object cleanup failed after metadata insert rejection.');
      return NextResponse.json({ error: 'The file could not be fully registered as a secure attachment. Please retry.' }, { status: 503 });
    }

    // 4. Post to trade chat; report a rejected insert instead of silently claiming success.
    const { error: chatError } = await adminSupabase.from('trade_messages').insert({
      trade_id: actualTradeId,
      sender_id: userId,
      message: `📎 Uploaded payment proof attachment: ${safeFileName}`,
      media_url: fileAccessUrl,
      media_type: fileType,
      file_name: safeFileName,
      file_size: uploadBuffer.length,
      is_moderator: false,
      visibility: 'participants',
    });
    if (chatError) {
      console.error('Trade attachment chat insert rejected:', chatError.code || 'unknown');
      const [{ error: fileRollbackError }, objectDeleted] = await Promise.all([
        adminSupabase.from('trade_files').delete().eq('id', savedFile.id).eq('trade_id', actualTradeId).eq('uploaded_by', userId),
        deleteFromB2(objectKey),
      ]);
      if (fileRollbackError) console.error('Trade attachment metadata rollback failed:', fileRollbackError.code || 'unknown');
      if (!objectDeleted) console.error('Private trade object cleanup failed after chat insert rejection.');
      return NextResponse.json({
        error: 'The file was uploaded, but could not be posted to chat. Please contact support@wayones.com with the trade ID.',
        code: chatError.code === 'P0001' ? 'TRADE_CHAT_LIMIT_REACHED' : 'TRADE_CHAT_INSERT_FAILED',
      }, { status: chatError.code === 'P0001' ? 429 : 503 });
    }

    return NextResponse.json({
      success: true,
      file_url: fileAccessUrl,
      file: savedFile || {
        trade_id: actualTradeId,
        uploaded_by: userId,
        file_type: fileType,
        file_name: safeFileName,
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
