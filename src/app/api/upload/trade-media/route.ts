import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { uploadToB2, deleteFromB2, compressTradeMedia, isB2Configured } from '@/lib/b2';

export const dynamic = 'force-dynamic';

const MAX_TRADE_MEDIA_REQUEST_BYTES = 34 * 1024 * 1024;

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
      if (totalBytes > MAX_TRADE_MEDIA_REQUEST_BYTES) {
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

export async function POST(req: NextRequest) {
  try {
    // Allow a small multipart envelope overhead while enforcing the 32 MiB file cap below.
    const contentLengthHeader = req.headers.get('content-length');
    const contentLength = contentLengthHeader ? Number(contentLengthHeader) : null;
    if (contentLength !== null && (!Number.isFinite(contentLength) || contentLength > 34 * 1024 * 1024)) {
      return NextResponse.json({ error: 'Upload request is too large. Each file can be up to 32 MB.' }, { status: 413 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Stream-cap the full multipart body as well as the individual file size.
    // Content-Length can be absent or forged, so it is only an early-reject hint.
    const requestBytes = await readBoundedRequestBody(req);
    if (requestBytes === null) {
      return NextResponse.json({ error: 'Upload request is too large. Each file can be up to 32 MB.' }, { status: 413 });
    }

    const multipartHeaders = new Headers(req.headers);
    multipartHeaders.delete('content-length');
    let formData: FormData;
    try {
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

    const file = formData.get('file') as File | null;
    const tradeId = (formData.get('tradeId') as string) || '';
    const requestedVisibility = formData.get('visibility');
    // Sender identity is always derived from the authenticated session, never the form.
    const senderId = user.id;
    if (requestedVisibility !== null && requestedVisibility !== 'all' && requestedVisibility !== 'moderator_only') {
      return NextResponse.json({ error: 'Invalid attachment visibility.' }, { status: 400 });
    }
    const visibility = requestedVisibility === 'moderator_only' ? 'moderator_only' : 'all';

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!tradeId || tradeId.length > 128) {
      return NextResponse.json({ error: 'A valid trade ID is required' }, { status: 400 });
    }

    // Resolve a real trade and verify the authenticated user is a participant.
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId);
    let trade: { id: string; buyer_id: string; seller_id: string; status?: string | null } | null = null;
    if (isUuid) {
      const { data, error } = await supabase.from('trades').select('id, buyer_id, seller_id, status').eq('id', tradeId).maybeSingle();
      if (error) {
        return NextResponse.json({ error: 'Unable to verify trade access. Please try again later.' }, { status: 503 });
      }
      trade = data;
      if (!trade) {
        const { data: p2pTrade, error: p2pError } = await supabase.from('p2p_trades').select('id, buyer_id, seller_id, status').eq('id', tradeId).maybeSingle();
        if (p2pError) {
          return NextResponse.json({ error: 'Unable to verify trade access. Please try again later.' }, { status: 503 });
        }
        trade = p2pTrade;
      }
    }
    if (!trade || (trade.buyer_id !== user.id && trade.seller_id !== user.id)) {
      return NextResponse.json({ error: 'Forbidden: you must be a participant in this trade.' }, { status: 403 });
    }
    if (visibility === 'moderator_only' && !['disputed', 'dispute'].includes(String(trade.status || '').toLowerCase())) {
      return NextResponse.json({ error: 'Moderator-only evidence can only be uploaded while the trade is in dispute.' }, { status: 409 });
    }
    const actualTradeId = trade.id;

    const fileType = file.type || '';
    let mediaType: 'image' | 'video' | 'document' = 'document';
    if (fileType.startsWith('image/')) mediaType = 'image';
    else if (fileType.startsWith('video/')) mediaType = 'video';
    else mediaType = 'document';

    // Every individual trade attachment is limited to 32 MiB, regardless of type.
    const MAX_FILE_SIZE = 32 * 1024 * 1024;
    if (file.size > MAX_FILE_SIZE) {
      return NextResponse.json(
        {
          error: 'FILE_SIZE_LIMIT_EXCEEDED',
          message: 'Each file can be up to 32 MB. Compress the file or share it through Google Drive or Dropbox instead.',
          alternatives: ['Google Drive', 'Dropbox'],
        },
        { status: 413 }
      );
    }

    // Enforce 3 files of each type per sender and trade across both legacy upload paths.
    // The same file may be represented in trade_files and trade_messages, so use max(), not sum().
    const [messageCountResult, fileCountResult] = await Promise.all([
      supabase
        .from('trade_messages')
        .select('id', { count: 'exact', head: true })
        .eq('trade_id', actualTradeId)
        .eq('sender_id', senderId)
        .eq('media_type', mediaType)
        .not('media_url', 'is', null),
      supabase
        .from('trade_files')
        .select('id', { count: 'exact', head: true })
        .eq('trade_id', actualTradeId)
        .eq('uploaded_by', senderId)
        .eq('file_type', mediaType)
        .or('is_external_link.is.null,is_external_link.eq.false'),
    ]);

    if (messageCountResult.error || fileCountResult.error) {
      return NextResponse.json({ error: 'Unable to verify the trade media quota. Please try again later.' }, { status: 503 });
    }

    const typeCount = Math.max(messageCountResult.count || 0, fileCountResult.count || 0);
    if (typeCount >= 3) {
      return NextResponse.json(
        {
          error: 'TRADE_MEDIA_LIMIT_REACHED',
          mediaType,
          limit: 3,
          message: `You have reached the limit of 3 ${mediaType}s for this trade. Share additional files using Google Drive or Dropbox and paste the share link in trade chat.`,
          alternatives: ['Google Drive', 'Dropbox'],
        },
        { status: 429 }
      );
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
    const key = `trades/${actualTradeId}/${Date.now()}_${sanitizedName}`;

    // Trade attachments are stored in Backblaze B2; fail closed when credentials are absent.
    if (!isB2Configured()) {
      return NextResponse.json({ error: 'Trade media storage is temporarily unavailable. Please try again later.' }, { status: 503 });
    }
    await uploadToB2(key, finalBuffer, finalContentType);

    // Register every uploaded object using server-only credentials. The live
    // trade_files INSERT policy intentionally does not allow clients to create
    // arbitrary attachment metadata.
    const adminSupabase = getSupabaseAdminClient();
    const { error: fileRecordError } = await adminSupabase
      .from('trade_files')
      .insert({
        trade_id: actualTradeId,
        uploaded_by: senderId,
        file_type: mediaType,
        file_name: sanitizedName,
        object_key: key,
        file_size: finalBuffer.length,
        mime_type: finalContentType,
        is_external_link: false,
        external_url: null,
      });

    if (fileRecordError) {
      console.error('[Trade media] Attachment metadata insert failed:', fileRecordError.code || 'unknown');
      const deleted = await deleteFromB2(key);
      if (!deleted) {
        console.error('[Trade media] Orphaned encrypted B2 object cleanup is required.');
      }
      return NextResponse.json(
        { error: 'The attachment could not be registered securely. Please retry.' },
        { status: 503 }
      );
    }

    // Provide only the authenticated application proxy URL; never expose B2 links.
    const proxyUrl = `/api/trade/media?key=${encodeURIComponent(key)}`;

    return NextResponse.json({
      success: true,
      url: proxyUrl,
      // Do not expose the direct B2 URL for private trade evidence.
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
