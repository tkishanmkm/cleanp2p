import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder-key'
);

export async function POST(req: NextRequest) {
  try {
    const { userId, country, address } = await req.json();

    if (!userId) {
      return NextResponse.json({ error: 'userId is required' }, { status: 400 });
    }

    // 1. Fetch user status
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('kyc_status, is_banned')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    // Rule: Immediately reject if already banned or approved
    if (profile.is_banned || profile.kyc_status === 'banned') {
      return NextResponse.json({ error: 'Account is banned from performing KYC' }, { status: 403 });
    }

    if (profile.kyc_status === 'approved') {
      // Immediate ban attempt: Trying to re-verify an already verified account
      await supabase.from('profiles').update({ is_banned: true, kyc_status: 'banned' }).eq('id', userId);
      return NextResponse.json({ error: 'Re-verification attempt detected. Account banned.' }, { status: 403 });
    }

    // 2. Save user address details in profiles
    await supabase.from('profiles').update({ country, address, kyc_status: 'pending' }).eq('id', userId);

    // 3. Request session from Didit
    const rawBaseUrl = process.env.DIDIT_API_URL || 'https://verification.didit.me/v3';
    const diditBase = rawBaseUrl.replace(/\/+$/, '');
    const targetUrl = `${diditBase}/session/`;

    const apiKey = process.env.DIDIT_API_KEY;
    const workflowId = process.env.DIDIT_WORKFLOW_ID || 'b36ac1aa-29fc-4272-8939-c1d184d072fd';
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || 'https://paxones.com').replace(/\/+$/, '');
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
        didit_session_id: sessionId,
        kyc_vendor_session_id: sessionId,
        updated_at: new Date().toISOString(),
      }).eq('id', userId);
    }

    return NextResponse.json({
      url: session.url,
      session_id: sessionId,
      didit_session_id: sessionId,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
