import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key'
  );
}

function getB2Client() {
  const endpoint = process.env.B2_ENDPOINT;
  const keyId = process.env.B2_ACCESS_KEY_ID || process.env.B2_KEY_ID;
  const appKey = process.env.B2_SECRET_ACCESS_KEY || process.env.B2_APP_KEY;
  if (!endpoint || !keyId || !appKey) {
    return null;
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
    const authHeader = req.headers.get('x-didit-signature');
    // Verify Webhook Signature if required by Didit setup
    
    const body = await req.json();
    const { session_id, status, user_id, document_image_url } = body;

    let b2DocumentUrl = null;

    // If Didit passed a document snapshot, copy it to Backblaze B2 for long-term audit storage
    if (document_image_url && status === 'APPROVED') {
      const b2Client = getB2Client();
      if (b2Client && process.env.B2_BUCKET_NAME) {
        const docRes = await fetch(document_image_url);
        if (docRes.ok) {
          const buffer = Buffer.from(await docRes.arrayBuffer());
          const objectKey = `kyc-documents/${user_id}/${session_id}.jpg`;

          await b2Client.send(
            new PutObjectCommand({
              Bucket: process.env.B2_BUCKET_NAME,
              Key: objectKey,
              Body: buffer,
              ContentType: 'image/jpeg',
            })
          );

          b2DocumentUrl = `${process.env.B2_ENDPOINT}/${process.env.B2_BUCKET_NAME}/${objectKey}`;
        }
      }
    }

    // Update Profile Status
    const supabaseAdmin = getSupabaseAdmin();
    await supabaseAdmin
      .from('profiles')
      .update({
        didit_session_id: session_id,
        didit_verification_status: status,
        didit_verified_at: status === 'APPROVED' ? new Date().toISOString() : null,
        ...(b2DocumentUrl ? { kyc_document_b2_url: b2DocumentUrl } : {}),
      })
      .eq('id', user_id);

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Didit webhook error:', err);
    return NextResponse.json({ error: 'Internal Webhook Failure' }, { status: 500 });
  }
}
