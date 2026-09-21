import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { createClient } from "@/utils/supabase/server";

export const dynamic = "force-dynamic";

const WORKFLOW_ID = "b36ac1aa-29fc-4272-8939-c1d184d072fd";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    let userId = body?.userId;

    if (!userId) {
      try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user?.id) {
          userId = user.id;
        }
      } catch (authErr) {
        console.warn("Could not retrieve user from session in /api/verify:", authErr);
      }
    }

    if (!userId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // 1. Fetch user record from Supabase
    const { data: user, error: userError } = await supabaseAdmin
      .from("profiles")
      .select("kyc_attempts, kyc_retry_count, kyc_status, kyc_last_attempt_at, kyc_submitted_at, updated_at")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return NextResponse.json({ error: "user_not_found" }, { status: 404 });
    }

    // 1.1 Check 24-hr under review timeout: if in review for > 24 hours without response, remove under review status
    const submittedTime = user.kyc_submitted_at ? new Date(user.kyc_submitted_at).getTime() : 0;
    const hoursSinceSubmission = (Date.now() - submittedTime) / (1000 * 60 * 60);
    const normalizedStatus = (user.kyc_status || '').toLowerCase();

    if (['in_review', 'under_review', 'pending_review'].includes(normalizedStatus) && user.kyc_submitted_at && hoursSinceSubmission >= 24) {
      await supabaseAdmin.from('profiles').update({
        kyc_status: 'not_started',
        didit_session_id: null,
        kyc_vendor_session_id: null,
        kyc_submitted_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', userId);
      user.kyc_status = 'not_started';
    }

    // 2. Enforce 3-attempt limit within 24 hours
    const lastAttemptTime = user.kyc_last_attempt_at ? new Date(user.kyc_last_attempt_at).getTime() : 0;
    const hoursSinceLastAttempt = (Date.now() - lastAttemptTime) / (1000 * 60 * 60);

    let currentAttempts = Number(user.kyc_attempts ?? user.kyc_retry_count ?? 0);

    // If 24 hours have elapsed since the last failed attempt, reset the rolling attempts counter
    if (hoursSinceLastAttempt >= 24 && currentAttempts > 0 && user.kyc_status !== 'approved' && user.kyc_status !== 'VERIFIED') {
      currentAttempts = 0;
      await supabaseAdmin.from('profiles').update({
        kyc_attempts: 0,
        kyc_retry_count: 0,
        updated_at: new Date().toISOString(),
      }).eq('id', userId);
    }

    if (currentAttempts >= 3 || user.kyc_status === "SUPPORT_REQUIRED" || user.kyc_status === "permanently_rejected") {
      return NextResponse.json(
        {
          error: "max_attempts_exceeded",
          code: "max_attempts_exceeded",
          message:
            "You have reached the maximum allowed verification attempts (3/3 in 24 hours). Please contact customer support.",
        },
        { status: 403 }
      );
    }

    // 3. Initiate Didit Session
    const rawBaseUrl = process.env.DIDIT_API_URL || 'https://verification.didit.me/v3';
    const diditBase = rawBaseUrl.replace(/\/+$/, '');
    const targetUrl = `${diditBase}/session/`;

    const workflowId = process.env.DIDIT_WORKFLOW_ID || WORKFLOW_ID;
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXT_PUBLIC_APP_URL || 'https://paxones.com').replace(/\/+$/, '');
    const callbackUrl = `${siteUrl}/dashboard/kyc/callback`;

    const apiKey = process.env.DIDIT_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "didit_api_key_missing", detail: "DIDIT_API_KEY environment variable is not configured." },
        { status: 500 }
      );
    }

    console.log('[DEBUG] Fetching URL:', targetUrl);

    let res: Response;
    try {
      res = await fetch(targetUrl, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "Content-Type": "application/json",
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
      return NextResponse.json({ error: "session_create_failed", detail: fetchErr.message }, { status: 502 });
    }

    if (!res.ok) {
      const detail = await res.text();
      console.error('[DEBUG] Didit API error response:', res.status, detail);
      return NextResponse.json(
        { error: "session_create_failed", detail },
        { status: 502 }
      );
    }

    const session = await res.json();
    const sessionId = session.session_id || session.id || session.vendor_session_id;

    // 4. Update profile kyc_status to 'in_review' immediately upon initiation
    try {
      await supabaseAdmin.from("profiles").update({
        kyc_status: "in_review",
        didit_session_id: sessionId,
        kyc_vendor_session_id: sessionId,
        kyc_submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", userId);
    } catch (profErr) {
      console.warn("Could not update profile to in_review:", profErr);
    }

    // 5. Log initial verification record in Supabase
    try {
      await supabaseAdmin.from("kyc_verifications").insert({
        user_id: userId,
        session_id: sessionId,
        status: "PENDING_REVIEW",
        vendor_data: { userId, workflowId, initiatedAt: new Date().toISOString() },
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      });
    } catch (insertErr) {
      console.warn("Could not insert to kyc_verifications:", insertErr);
    }

    return NextResponse.json({
      success: true,
      url: session.url,
      sessionUrl: session.url,
      session_id: sessionId,
      sessionId: sessionId,
      status: "in_review",
    });
  } catch (error) {
    console.error("Session Error:", error);
    return NextResponse.json(
      { error: "internal_server_error" },
      { status: 500 }
    );
  }
}
