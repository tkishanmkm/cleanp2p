import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate caller session
    const supabaseUser = await createClient();
    let { data: { user } } = await supabaseUser.auth.getUser();

    const authHeader = req.headers.get("authorization");
    if (!user && authHeader && authHeader.startsWith("Bearer ")) {
      const token = authHeader.substring(7).trim();
      if (token) {
        const adminClient = getSupabaseAdminClient();
        const { data: tokenData } = await adminClient.auth.getUser(token);
        if (tokenData?.user) user = tokenData.user;
      }
    }

    if (!user) {
      return NextResponse.json(
        { error: "Unauthorized. Authentication session required to initiate KYC." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const requestedUserId = body?.userId || body?.user_id;
    let userId = user.id;

    if (requestedUserId && requestedUserId !== user.id) {
      const adminAuth = await verifyServerAdmin(req);
      if (!adminAuth.authorized) {
        return NextResponse.json(
          { error: "Forbidden: Cannot initiate verification for another user." },
          { status: 403 }
        );
      }
      userId = requestedUserId;
    }

    const supabase = getSupabaseAdminClient();

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

