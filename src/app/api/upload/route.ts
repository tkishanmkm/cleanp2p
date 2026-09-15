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

    let objectKey = '';
    const isPrivateDocument =
      category === 'kyc-image' || category === 'kyc-data' || category === 'trade-attachment';

    if (category === 'avatar') {
      objectKey = `avatars/${userId}.${fileExtension || 'webp'}`;
    } else if (category === 'kyc-image') {
      objectKey = `kyc-documents/${userId}.${fileExtension || 'webp'}`;
    } else if (category === 'kyc-data') {
      objectKey = `kyc-documents/${userId}.json.gz`;
    } else if (category === 'trade-attachment') {
      const tradePrefix = tradeId ? `${tradeId}/` : '';
      objectKey = `trades/${tradePrefix}${userId}-${Date.now()}.${fileExtension || 'webp'}`;
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
      ContentType: contentType || 'image/webp',
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
