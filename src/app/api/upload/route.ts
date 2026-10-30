import { NextResponse } from 'next/server';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient } from '@/lib/supabase/server';
import { getB2Client, getB2Config, compressKycData } from '@/lib/b2';

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { category, fileExtension, contentType, isTxtData, txtContent, tradeId } =
      await req.json();
    const userId = user.id;

    const allowedCategories = new Set(['avatar', 'kyc-image', 'kyc-data', 'trade-attachment']);
    if (typeof category !== 'string' || !allowedCategories.has(category)) {
      return NextResponse.json({ error: 'Unsupported upload category.' }, { status: 400 });
    }

    const allowedExtensions: Record<string, Set<string>> = {
      avatar: new Set(['webp', 'png', 'jpg', 'jpeg']),
      'kyc-image': new Set(['webp', 'png', 'jpg', 'jpeg', 'pdf']),
      'kyc-data': new Set(['json', 'gz']),
      'trade-attachment': new Set(['webp', 'png', 'jpg', 'jpeg', 'pdf', 'txt']),
    };
    const extension = String(fileExtension || (category === 'kyc-data' ? 'gz' : 'webp'))
      .replace(/^\\./, '')
      .toLowerCase();
    if (!allowedExtensions[category].has(extension)) {
      return NextResponse.json({ error: 'File extension is not allowed for this upload category.' }, { status: 400 });
    }

    const allowedContentTypes = new Set([
      'image/webp', 'image/png', 'image/jpeg', 'application/pdf',
      'text/plain', 'application/json', 'application/gzip', 'application/octet-stream',
    ]);
    const normalizedContentType = String(contentType || 'image/webp').toLowerCase().trim();
    if (!allowedContentTypes.has(normalizedContentType)) {
      return NextResponse.json({ error: 'File content type is not allowed.' }, { status: 400 });
    }
    if (isTxtData && (category !== 'kyc-data' || typeof txtContent !== 'string' || Buffer.byteLength(txtContent, 'utf8') > 1024 * 1024)) {
      return NextResponse.json({ error: 'Invalid or oversized text upload.' }, { status: 400 });
    }

    // Trade evidence must be uploaded only by a participant in the referenced trade.
    // Use the caller's session client and fail closed on lookup errors/missing trades.
    if (category === 'trade-attachment') {
      const validTradeId = typeof tradeId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tradeId);
      if (!validTradeId) {
        return NextResponse.json({ error: 'A valid trade ID is required.' }, { status: 400 });
      }
      const { data: trade, error: tradeError } = await supabase
        .from('trades')
        .select('id, buyer_id, seller_id')
        .eq('id', tradeId)
        .maybeSingle();
      if (tradeError || !trade || (trade.buyer_id !== userId && trade.seller_id !== userId)) {
        return NextResponse.json({ error: 'You are not authorized to upload evidence for this trade.' }, { status: 403 });
      }
    }

    let objectKey = '';
    const isPrivateDocument =
      category === 'kyc-image' || category === 'kyc-data' || category === 'trade-attachment';

    if (category === 'avatar') {
      objectKey = `avatars/${userId}.${extension}`;
    } else if (category === 'kyc-image') {
      objectKey = `kyc-documents/${userId}.${extension}`;
    } else if (category === 'kyc-data') {
      objectKey = `kyc-documents/${userId}.json.gz`;
    } else if (category === 'trade-attachment') {
      const tradePrefix = tradeId ? `${tradeId}/` : '';
      objectKey = `trades/${tradePrefix}${userId}-${Date.now()}.${extension}`;
    } else {
      objectKey = `misc/${userId}-${Date.now()}.${fileExtension || 'bin'}`;
    }

    const b2Client = getB2Client();
    const config = getB2Config();
    const bucketName = config.bucketName;

    // If uploading raw text / KYC details directly to B2 (compressed gzip)
    if (isTxtData && txtContent) {
      let compressedBody: Buffer;
      try {
        compressedBody = await compressKycData({ content: txtContent });
      } catch {
        compressedBody = Buffer.from(txtContent, 'utf-8');
      }

      await b2Client.send(
        new PutObjectCommand({
          Bucket: bucketName,
          Key: objectKey,
          Body: compressedBody,
          ContentType: 'application/json',
          ContentEncoding: 'gzip',
        })
      );

      return NextResponse.json({
        success: true,
        objectKey,
        isPrivate: isPrivateDocument,
      });
    }

    // Direct Pre-signed Upload URL for binary uploads (PUT)
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      ContentType: normalizedContentType,
    });

    const uploadUrl = await getSignedUrl(b2Client, command, { expiresIn: 900 });
    const publicUrl = isPrivateDocument
      ? undefined
      : `${config.endpoint.replace(/\/+$/, '')}/${bucketName}/${objectKey}`;

    return NextResponse.json({
      uploadUrl,
      publicUrl,
      objectKey,
      isPrivate: isPrivateDocument,
    });
  } catch (err: any) {
    console.error('Upload error:', err);
    return NextResponse.json(
      { error: err?.message || 'Unable to process upload.' },
      { status: 500 }
    );
  }
}
