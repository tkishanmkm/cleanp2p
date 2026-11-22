import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/lib/supabase/server';
import { verifyServerAdmin } from '@/lib/server-admin-auth';
import { saveKycAddressToB2 } from '@/lib/b2';
import { isTier2User } from '@/lib/kyc';
import { getDiditServerConfig } from '@/lib/didit-config';

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
        { error: "unauthorized", message: "Authentication session required to initiate KYC." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { userId: requestedUserId, country, address, street, city, postalCode, docType, docNumber } = body;

    let targetUserId = user.id;
    if (requestedUserId && requestedUserId !== user.id) {
      const adminAuth = await verifyServerAdmin(req);
      if (!adminAuth.authorized) {
        return NextResponse.json(
          { error: "forbidden", message: "Cannot initiate KYC verification for another user." },
          { status: 403 }
        );
      }
      targetUserId = requestedUserId;
    }

    const userId = targetUserId;
    const diditConfig = getDiditServerConfig();
    if (!diditConfig) {
      return NextResponse.json({ error: 'Verification service is not configured' }, { status: 503 });
    }
    const { apiKey, workflowId, sessionUrl: targetUrl, callbackUrl } = diditConfig;
    const supabase = getSupabaseAdminClient();

    // 1. Fetch user status
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('kyc_status, is_banned, kyc_retry_count, kyc_attempts, kyc_last_attempt_at, kyc_submitted_at, is_verified, id_verified')
      .eq('id', userId)
      .single();

    if (error || !profile) {
      return NextResponse.json({ error: 'User profile not found' }, { status: 404 });
    }

    // Rule: Immediately reject if already banned
    if (profile.is_banned || profile.kyc_status === 'banned') {
      return NextResponse.json({ error: 'Account is banned from performing KYC' }, { status: 403 });
    }

    const isApprovedTier2 = isTier2User(profile);
    if (isApprovedTier2) {
      return NextResponse.json({
        success: true,
        message: 'Account is already verified with Tier 2 privileges.',
        status: 'approved',
      });
    }

    // Sanitize residual flags if user is not actually Tier 2
    if (profile.is_verified || profile.id_verified) {
      await supabase
        .from('profiles')
        .update({ is_verified: false, id_verified: false, updated_at: new Date().toISOString() })
        .eq('id', userId);
      profile.is_verified = false;
      profile.id_verified = false;
    }

    const lastAttemptTime = profile.kyc_last_attempt_at || profile.kyc_submitted_at;
    const hoursSinceLastAttempt = lastAttemptTime ? (Date.now() - new Date(lastAttemptTime).getTime()) / (1000 * 60 * 60) : 999;

    let retryCount = Number(profile.kyc_retry_count || profile.kyc_attempts || 0);

    // If 24 hours have passed since previous attempt, reset the attempt count
    if (hoursSinceLastAttempt >= 24) {
      retryCount = 0;
    }

    // Rule: Reject if 3 retries exceeded or permanently rejected
    if (profile.kyc_status === 'permanently_rejected' || retryCount >= 3) {
      return NextResponse.json({
        error: 'KYC_LIMIT_REACHED',
        message: 'Maximum KYC retry attempts (3/3) exceeded in 24 hours. Your verification is locked. Please contact support.',
      }, { status: 403 });
    }

    // Rule: If under review and within 24 hours, inform user
    if ((profile.kyc_status === 'in_review' || profile.kyc_status === 'pending') && hoursSinceLastAttempt < 24) {
      return NextResponse.json({
        error: 'KYC_UNDER_REVIEW',
        message: 'Your verification is currently under review (active for up to 24 hours). Please wait or sync status.',
      }, { status: 400 });
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

    // 4. Request session from verification service


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
      console.error('[KYC INITIATE] Failed target:', targetUrl, fetchErr);
      return NextResponse.json({ error: 'Verification service network connection failed', detail: fetchErr.message }, { status: 502 });
    }

    if (!res.ok) {
      const detail = await res.text();
      console.error('[KYC INITIATE] Service error response:', res.status, detail);
      return NextResponse.json({ error: 'Failed to create verification session', detail }, { status: 502 });
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
