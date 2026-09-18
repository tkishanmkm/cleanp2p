import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key'
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const supabase = getSupabaseAdmin();

    let userId = body?.userId || body?.user_id;

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // 1. Fetch user record
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id, kyc_status, is_banned, kyc_retry_count, kyc_attempts, kyc_last_attempt_at')
      .eq('id', userId)
      .maybeSingle();

    if (profileErr || !profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    if (profile.is_banned || profile.kyc_status === 'banned') {
      return NextResponse.json({ error: 'Account is banned from KYC' }, { status: 403 });
    }

    // 24-hour rolling window check
    const lastAttemptTime = profile.kyc_last_attempt_at ? new Date(profile.kyc_last_attempt_at).getTime() : 0;
    const hoursSinceLastAttempt = (Date.now() - lastAttemptTime) / (1000 * 60 * 60);

    let attempts = Number(profile.kyc_attempts ?? profile.kyc_retry_count ?? 0);

    if (hoursSinceLastAttempt >= 24 && attempts > 0 && profile.kyc_status !== 'approved') {
      attempts = 0;
      await supabase.from('profiles').update({
        kyc_attempts: 0,
        kyc_retry_count: 0,
        updated_at: new Date().toISOString(),
      }).eq('id', userId);
    }

    if (attempts >= 3 || profile.kyc_status === 'permanently_rejected' || profile.kyc_status === 'SUPPORT_REQUIRED') {
      return NextResponse.json(
        {
          error: 'max_attempts_exceeded',
          code: 'max_attempts_exceeded',
          message: 'Maximum KYC attempts (3/3 in 24 hours) exceeded. Please contact support.',
        },
        { status: 403 }
      );
    }

    // 2. Prepare Didit Session Call
    const rawBaseUrl = process.env.DIDIT_API_URL || 'https://verification.didit.me/v3';
    const diditBase = rawBaseUrl.replace(/\/+$/, '');
    const targetUrl = `${diditBase}/session/`;

    const workflowId = process.env.DIDIT_WORKFLOW_ID || 'b36ac1aa-29fc-4272-8939-c1d184d072fd';
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://paxones.com').replace(/\/+$/, '');
    const callbackUrl = `${siteUrl}/dashboard/kyc/callback`;

    const apiKey = process.env.DIDIT_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'DIDIT_API_KEY is not configured in environment.' },
        { status: 500 }
      );
    }

    const diditRes = await fetch(targetUrl, {
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

    if (!diditRes.ok) {
      const detail = await diditRes.text();
      console.error('[DIDIT] Session creation error:', diditRes.status, detail);
      return NextResponse.json({ error: 'Failed to create Didit session', detail }, { status: 502 });
    }

    const session = await diditRes.json();
    const sessionId = session.session_id || session.id || session.vendor_session_id;

    // 3. Mark profile as "in_review" immediately
    await supabase.from('profiles').update({
      kyc_status: 'in_review',
      didit_session_id: sessionId,
      kyc_vendor_session_id: sessionId,
      kyc_submitted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq('id', userId);

    // 4. Record in kyc_verifications table
    try {
      await supabase.from('kyc_verifications').insert({
        user_id: userId,
        session_id: sessionId,
        status: 'PENDING_REVIEW',
        vendor_data: { userId, workflowId, initiatedAt: new Date().toISOString() },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } catch (insertErr) {
      console.warn('Non-fatal: kyc_verifications insert:', insertErr);
    }

    return NextResponse.json({
      success: true,
      url: session.url,
      sessionUrl: session.url,
      session_id: sessionId,
      sessionId: sessionId,
      status: 'in_review',
    });
  } catch (error: any) {
    console.error('Didit verify route error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Internal verification error' },
      { status: 500 }
    );
  }
}

