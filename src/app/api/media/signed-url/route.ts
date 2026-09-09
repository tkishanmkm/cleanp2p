import { NextResponse } from 'next/server';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient } from '@/lib/supabase/server';

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
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { objectKey, tradeId } = await req.json();

    if (!objectKey || typeof objectKey !== 'string') {
      return NextResponse.json({ error: 'objectKey is required' }, { status: 400 });
    }

    // Path Traversal Sanitization
    const sanitizedKey = objectKey.replace(/\.\./g, '').trim();

    // Access Control Validation
    const { data: profile } = await supabase
      .from('profiles')
      .select('is_admin, role')
      .eq('id', user.id)
      .maybeSingle();

    const isAdmin = profile?.is_admin === true || profile?.role === 'admin' || profile?.role === 'compliance' || profile?.role === 'support';

    // 1. If KYC Document: Only owner or compliance/admin can access
    if (sanitizedKey.startsWith('kyc-documents/')) {
      const targetUserId = sanitizedKey.replace('kyc-documents/', '').split('.')[0];
      if (targetUserId !== user.id && !isAdmin) {
        return NextResponse.json({ error: 'Access denied to sensitive compliance document' }, { status: 403 });
      }
    }

    // 2. If Trade Attachment: Must be buyer, seller, or admin on that trade
    if (sanitizedKey.startsWith('trades/') && tradeId) {
      const { data: trade } = await supabase
        .from('trades')
        .select('buyer_id, seller_id')
        .eq('id', tradeId)
        .maybeSingle();

      if (!isAdmin && trade && trade.buyer_id !== user.id && trade.seller_id !== user.id) {
        return NextResponse.json({ error: 'Access denied to private trade attachment' }, { status: 403 });
      }
    }

    // Generate Short-lived 5-minute (300 seconds) Pre-signed Read URL
    const b2Client = getB2Client();
    const bucketName = process.env.B2_BUCKET_NAME || 'thepax';

    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: sanitizedKey,
    });

    const signedReadUrl = await getSignedUrl(b2Client, command, { expiresIn: 300 });

    return NextResponse.json({
      success: true,
      signedUrl: signedReadUrl,
      expiresInSeconds: 300,
      objectKey: sanitizedKey,
    });
  } catch (err: any) {
    console.error('Signed URL generation error:', err);
    return NextResponse.json({ error: err?.message || 'Unable to generate secure signed URL' }, { status: 500 });
  }
}
