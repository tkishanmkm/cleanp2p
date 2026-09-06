import { NextResponse } from 'next/server';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient } from '@/utils/supabase/server';

function getB2Client() {
  const endpoint = process.env.B2_ENDPOINT;
  const keyId = process.env.B2_ACCESS_KEY_ID || process.env.B2_KEY_ID;
  const appKey = process.env.B2_SECRET_ACCESS_KEY || process.env.B2_APP_KEY;
  if (!endpoint || !keyId || !appKey) {
    throw new Error('Backblaze B2 storage credentials are not configured.');
  }

  return new S3Client({
    endpoint,
    region: process.env.B2_REGION || 'us-east-005',
    credentials: {
      accessKeyId: keyId,
      secretAccessKey: appKey,
    },
    forcePathStyle: true,
  });
}

export async function POST(req: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { category, fileExtension, contentType, isTxtData, txtContent } = await req.json();
    const userId = user.id; // Unique Immutable ID (never public)

    let objectKey = '';

    if (category === 'avatar') {
      objectKey = `avatars/${userId}.${fileExtension || 'jpg'}`;
    } else if (category === 'kyc-image') {
      objectKey = `kyc-documents/${userId}.${fileExtension || 'jpg'}`;
    } else if (category === 'kyc-data') {
      objectKey = `kyc-documents/${userId}.txt`;
    } else {
      objectKey = `misc/${userId}-${Date.now()}.${fileExtension || 'bin'}`;
    }

    const b2Client = getB2Client();
    const bucketName = process.env.B2_BUCKET_NAME || 'thepax';

    // If uploading raw text verification details directly to B2 (.txt)
    if (isTxtData && txtContent) {
      await b2Client.send(new PutObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
        Body: Buffer.from(txtContent, 'utf-8'),
        ContentType: 'text/plain',
      }));

      const fileUrl = `${process.env.B2_ENDPOINT}/${bucketName}/${objectKey}`;
      return NextResponse.json({ success: true, publicUrl: fileUrl, objectKey });
    }

    // Direct Pre-signed Upload URL for binary images
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: objectKey,
      ContentType: contentType || 'image/jpeg',
    });

    const uploadUrl = await getSignedUrl(b2Client, command, { expiresIn: 900 });
    const publicUrl = `${process.env.B2_ENDPOINT}/${bucketName}/${objectKey}`;

    return NextResponse.json({ uploadUrl, publicUrl, objectKey });
  } catch (err: any) {
    console.error('Upload error:', err);
    return NextResponse.json({ error: err?.message || 'Unable to process upload.' }, { status: 500 });
  }
}
