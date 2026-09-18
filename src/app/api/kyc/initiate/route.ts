import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { saveKycAddressToB2 } from '@/lib/b2';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key'
);

export async function POST(req: NextRequest) {
  try {
    const { userId, country, address, street, city, postalCode, docType, docNumber } =
      await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // 1. Fetch user status
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('kyc_status, is_banned, kyc_retry_count, kyc_attempts')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    // Rule: Immediately reject if already banned
    if (profile.is_banned || profile.kyc_status === 'banned') {
      return NextResponse.json({ error: 'Account is banned from performing KYC' }, { status: 403 });
    }

    // Rule: Reject if 3 retries exceeded or permanently rejected
    const retryCount = Number(profile.kyc_retry_count || profile.kyc_attempts || 0);
    if (profile.kyc_status === 'permanently_rejected' || retryCount >= 3) {
      return NextResponse.json({
        error: 'KYC_LIMIT_REACHED',
        message: 'Maximum KYC retry attempts (3/3) exceeded. Your verification is permanently locked. Please contact support.',
      }, { status: 403 });
    }

    if (profile.kyc_status === 'approved') {
      // Immediate ban attempt: Trying to re-verify an already verified account
      await supabase.from('profiles').update({ is_banned: true, kyc_status: 'banned' }).eq('id', userId);
      return NextResponse.json({ error: 'Re-verification attempt detected. Account banned.' }, { status: 403 });
    }

    // 2. Compress and save KYC address details directly into Backblaze B2 (Private compliance document)
    let b2Key = '';
    try {
      const b2Res = await saveKycAddressToB2(userId, {
        userId,
        country,
        address,
        street,
        city,
        postalCode,
        docType,
        docNumber,
        submittedAt: new Date().toISOString(),
      });
      if (b2Res.success) {
        b2Key = b2Res.key;
      }
    } catch (b2Err) {
      console.warn('Non-fatal: Failed to save KYC address to B2:', b2Err);
    }

    // 3. Save user address details in profiles table
    await supabase
      .from('profiles')
      .update({
        country,
        address,
        kyc_status: 'in_review',
        kyc_submitted_at: new Date().toISOString(),
        ...(b2Key ? { kyc_documents_b2_key: b2Key } : {}),
      })
      .eq('id', userId);

    // 4. Request session from Didit
    const rawBaseUrl = process.env.DIDIT_API_URL || 'https://verification.didit.me/v3';
    const diditBase = rawBaseUrl.replace(/\/+$/, '');
    const targetUrl = `${diditBase}/session/`;

    const apiKey = process.env.DIDIT_API_KEY;
    const workflowId = process.env.DIDIT_WORKFLOW_ID || 'b36ac1aa-29fc-4272-8939-c1d184d072fd';
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://paxones.com').replace(/\/+$/, '');
    const callbackUrl = `${siteUrl}/dashboard/kyc/callback`;

    if (!apiKey) {
      return NextResponse.json({ error: 'DIDIT_API_KEY is not configured' }, { status: 500 });
    }

    console.log('[DEBUG] Fetching URL:', targetUrl);

    let res: Response;
    try {
      res = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          workflow_id: workflowId,
          vendor_data: userId,
          callback: callbackUrl,
        }),
      });
    } catch (fetchErr: any) {
      console.error('[DEBUG] Failed Fetch Target:', targetUrl);
      console.error(fetchErr);
      return NextResponse.json({ error: 'Didit network connection failed', detail: fetchErr.message }, { status: 502 });
    }

    if (!res.ok) {
      const detail = await res.text();
      console.error('[DEBUG] Didit API error response:', res.status, detail);
      return NextResponse.json({ error: 'Failed to create Didit session', detail }, { status: 502 });
    }

    const session = await res.json();
    const sessionId = session.session_id || session.id || session.vendor_session_id;

    if (sessionId) {
      await supabase.from('profiles').update({
        kyc_status: 'in_review',
        didit_session_id: sessionId,
        kyc_vendor_session_id: sessionId,
        kyc_submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', userId);

      try {
        await supabase.from('kyc_verifications').insert({
          user_id: userId,
          session_id: sessionId,
          status: 'PENDING_REVIEW',
          vendor_data: { userId, workflowId, country, address, initiatedAt: new Date().toISOString() },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });
      } catch (insertErr) {
        console.warn('Non-fatal: kyc_verifications insert:', insertErr);
      }
    }

    return NextResponse.json({
      success: true,
      url: session.url,
      session_id: sessionId,
      didit_session_id: sessionId,
      status: 'in_review',
      b2_key: b2Key,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
