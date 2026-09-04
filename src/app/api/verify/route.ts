import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const WORKFLOW_ID = "b36ac1aa-29fc-4272-8939-c1d184d072fd";

export async function POST(req: Request) {
  try {
    const { userId } = await req.json().catch(() => ({ userId: undefined }));

    if (!userId) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }

    // 1. Fetch user record from Supabase
    const { data: user, error: userError } = await supabaseAdmin
      .from("profiles")
      .select("kyc_attempts, kyc_status")
      .eq("id", userId)
      .single();

    if (userError || !user) {
      return NextResponse.json({ error: "user_not_found" }, { status: 404 });
    }

    // 2. Enforce 3-attempt limit check
    if ((user.kyc_attempts ?? 0) >= 3 || user.kyc_status === "SUPPORT_REQUIRED") {
      return NextResponse.json(
        {
          error: "max_attempts_exceeded",
          code: "max_attempts_exceeded",
          message:
            "You have reached the maximum allowed verification attempts (3/3). Please contact customer support.",
        },
        { status: 403 }
      );
    }

    // 3. Initiate Didit Session
    const callbackUrl = process.env.NEXT_PUBLIC_APP_URL
      ? `${process.env.NEXT_PUBLIC_APP_URL}/p2p/verification-callback`
      : "https://myapp.com/p2p/verification-callback";

    const apiKey = process.env.DIDIT_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "didit_api_key_missing", detail: "DIDIT_API_KEY environment variable is not configured." },
        { status: 500 }
      );
    }

    const res = await fetch("https://verification.didit.me/v3/session/", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        workflow_id: WORKFLOW_ID,
        vendor_data: userId,
        callback: callbackUrl,
      }),
    });

    if (!res.ok) {
      const detail = await res.text();
      return NextResponse.json(
        { error: "session_create_failed", detail },
        { status: 502 }
      );
    }

    const session = await res.json();

    // 4. Log initial verification record in Supabase
    try {
      await supabaseAdmin.from("kyc_verifications").insert({
        user_id: userId,
        session_id: session.session_id,
        status: "PENDING_REVIEW",
      });
    } catch (insertErr) {
      console.warn("Could not insert to kyc_verifications:", insertErr);
    }

    return NextResponse.json({
      url: session.url,
      sessionUrl: session.url,
      session_id: session.session_id,
    });
  } catch (error) {
    console.error("Session Error:", error);
    return NextResponse.json(
      { error: "internal_server_error" },
      { status: 500 }
    );
  }
}
