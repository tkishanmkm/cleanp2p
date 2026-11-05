import { NextRequest, NextResponse } from 'next/server';
import { GetObjectCommand } from '@aws-sdk/client-s3';
import { decryptPrivateB2Data, isEncryptedPrivateB2Data, getB2Client, getB2Config } from '@/lib/b2';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import zlib from 'zlib';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const config = getB2Config();
    if (!config.isConfigured) {
      return NextResponse.json({ error: 'Trade media storage is temporarily unavailable.' }, { status: 503 });
    }
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

    // Normalize and strictly constrain the object key before any storage access.
    key = key.replace(/^\/+/, '');
    if (key.includes('..') || key.includes('\\') || key.includes('\0')) {
      return NextResponse.json({ error: 'Invalid media key' }, { status: 400 });
    }

    const keyMatch = /^trades\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/.+$/i.exec(key);
    if (!keyMatch) {
      return NextResponse.json({ error: 'Invalid trade media key' }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const tradeId = keyMatch[1];
    let trade: { id: string; buyer_id: string; seller_id: string } | null = null;
    const { data: primaryTrade, error: primaryError } = await supabase
      .from('trades')
      .select('id, buyer_id, seller_id')
      .eq('id', tradeId)
      .maybeSingle();
    if (primaryError) {
      return NextResponse.json({ error: 'Unable to verify trade access' }, { status: 503 });
    }
    trade = primaryTrade;
    if (!trade) {
      const { data: p2pTrade, error: p2pError } = await supabase
        .from('p2p_trades')
        .select('id, buyer_id, seller_id')
        .eq('id', tradeId)
        .maybeSingle();
      if (p2pError) {
        return NextResponse.json({ error: 'Unable to verify trade access' }, { status: 503 });
      }
      trade = p2pTrade;
    }

    // Read the trusted role server-side: ordinary authenticated profile SELECT is
    // intentionally restricted, so do not depend on client-role table grants here.
    const adminSupabase = getSupabaseAdminClient();
    const { data: profile, error: profileError } = await adminSupabase
      .from('profiles')
      .select('role, status, account_status, is_banned, is_suspended, is_restricted, is_on_hold, is_emergency_frozen, is_minor_restricted')
      .eq('id', user.id)
      .maybeSingle();
    if (profileError) {
      return NextResponse.json({ error: 'Unable to verify media access' }, { status: 503 });
    }

    const moderatorStatus = String(profile?.status || '').toLowerCase();
    const moderatorAccountStatus = String(profile?.account_status || '').toLowerCase();
    const moderatorBlocked =
      !profile ||
      profile.is_banned === true ||
      profile.is_suspended === true ||
      profile.is_restricted === true ||
      profile.is_on_hold === true ||
      profile.is_emergency_frozen === true ||
      profile.is_minor_restricted === true ||
      moderatorStatus !== 'active' ||
      ['banned', 'suspended', 'restricted', 'inactive', 'deleted', 'on_hold', 'hold', 'deletion_pending'].includes(moderatorAccountStatus);
    const isModerator =
      !moderatorBlocked &&
      (profile?.role === 'admin' || profile?.role === 'moderator');
    const isParticipant = Boolean(trade && (trade.buyer_id === user.id || trade.seller_id === user.id));
    if (!trade || (!isParticipant && !isModerator)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    // The live schema stores attachment references in trade_messages.media_url.
    // Require both the registered file metadata and the matching chat row.
    const mediaUrl = `/api/trade/media?key=${encodeURIComponent(key)}`;
    const { data: fileRecord, error: fileRecordError } = await adminSupabase
      .from('trade_files')
      .select('id, uploaded_by, file_type')
      .eq('trade_id', trade.id)
      .eq('object_key', key)
      .maybeSingle();

    if (fileRecordError) {
      return NextResponse.json({ error: 'Unable to verify attachment record' }, { status: 503 });
    }
    if (!fileRecord) {
      return NextResponse.json({ error: 'Attachment record not found' }, { status: 404 });
    }

    const { data: mediaMessage, error: mediaMessageError } = await adminSupabase
      .from('trade_messages')
      .select('sender_id, visibility')
      .eq('trade_id', trade.id)
      .eq('media_url', mediaUrl)
      .maybeSingle();

    if (mediaMessageError) {
      return NextResponse.json({ error: 'Unable to verify attachment visibility' }, { status: 503 });
    }
    if (!mediaMessage) {
      return NextResponse.json({ error: 'Attachment record not found' }, { status: 404 });
    }
    if (fileRecord.uploaded_by !== mediaMessage.sender_id) {
      return NextResponse.json({ error: 'Attachment ownership could not be verified' }, { status: 403 });
    }
    if (mediaMessage.visibility === 'moderator_only'
      && !isModerator
      && mediaMessage.sender_id !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const command = new GetObjectCommand({
      Bucket: b2Bucket,
      Key: key,
    });

    const response = await s3Client.send(command);

    if (!response.Body) {
      return NextResponse.json({ error: 'File body not found' }, { status: 404 });
    }

    const storedContentType = (response.ContentType || '').split(';')[0].trim().toLowerCase();
    const safeInlineTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
    // Never trust object metadata to enable inline HTML, SVG, or other active content.
    const contentType = safeInlineTypes.has(storedContentType) ? storedContentType : 'application/octet-stream';
    const rawFilename = key.split('/').pop() || 'trade-media';
    const filename = rawFilename.replace(/[\r\n"\\]/g, '_').slice(0, 180) || 'trade-media';
    const canInline = safeInlineTypes.has(storedContentType) && !download;

    // Bound proxy memory use even if stored object metadata is incorrect.
    const maxMediaBytes = 32 * 1024 * 1024;
    const maxStoredMediaBytes = maxMediaBytes + 64;
    if (typeof response.ContentLength === 'number' && response.ContentLength > maxStoredMediaBytes) {
      return NextResponse.json({ error: 'Trade media exceeds the 32 MB delivery limit.' }, { status: 413 });
    }
    const stream = response.Body as any;
    const chunks: Buffer[] = [];
    let totalBytes = 0;
    for await (const chunk of stream) {
      const part = typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk);
      totalBytes += part.length;
      if (totalBytes > maxStoredMediaBytes) {
        return NextResponse.json({ error: 'Trade media exceeds the 32 MB delivery limit.' }, { status: 413 });
      }
      chunks.push(part);
    }
    let buffer: Buffer<ArrayBufferLike> = Buffer.concat(chunks);

    try {
      // Trade evidence must be AES-GCM encrypted at rest. Legacy plaintext
      // objects are intentionally blocked until a controlled re-encryption pass.
      if (!isEncryptedPrivateB2Data(buffer)) {
        throw new Error('Private attachment is not encrypted.');
      }
      buffer = decryptPrivateB2Data(buffer);
    } catch {
      return NextResponse.json(
        { error: 'Private attachment is unavailable until secure storage migration is complete.' },
        { status: 503 }
      );
    }

    // Auto-decompress if stored as gzipped and requested as standard preview
    if (response.ContentEncoding === 'gzip' || key.endsWith('.gz')) {
      try {
        // Compressed trade files are user-controlled. Cap decompressed output to
        // prevent a small gzip bomb from exhausting the server process memory.
        buffer = zlib.gunzipSync(buffer, { maxOutputLength: maxMediaBytes });
      } catch (gunzipErr: any) {
        if (gunzipErr?.code === 'ERR_BUFFER_TOO_LARGE') {
          return NextResponse.json({ error: 'Decompressed trade media exceeds the 32 MB delivery limit.' }, { status: 413 });
        }
        console.warn('Gunzip error during proxy stream; returning original attachment bytes.');
      }
    }
    if (buffer.length > maxMediaBytes) {
      return NextResponse.json({ error: 'Trade media exceeds the 32 MB delivery limit.' }, { status: 413 });
    }

    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': buffer.length.toString(),
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    };

    headers['Content-Disposition'] = canInline
      ? `inline; filename="${filename}"`
      : `attachment; filename="${filename}"`;

    // NextResponse's DOM BodyInit type does not accept Node Buffer<ArrayBufferLike>
    // in the current Node typings. Copy the exact bytes into a standard ArrayBuffer.
    const responseBody = new ArrayBuffer(buffer.byteLength);
    new Uint8Array(responseBody).set(buffer);
    return new NextResponse(responseBody, {
      status: 200,
      headers,
    });
  } catch (error: any) {
    console.error('Error fetching trade media proxy:', { name: error?.name || 'UnknownError' });
    return NextResponse.json(
      { error: 'Failed to retrieve trade media. Please try again later.' },
      { status: 500 }
    );
  }
}
