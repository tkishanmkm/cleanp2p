import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { verifyServerAdmin } from "@/lib/server-admin-auth";

export const dynamic = "force-dynamic";

/**
 * Read-only support admins may raise a restriction request for review.
 * They cannot directly modify a profile, ads, balances, or platform controls.
 */
export async function POST(req: NextRequest) {
  const auth = await verifyServerAdmin(req, { allowSupportReadOnly: true });
  if (!auth.authorized || !auth.user || auth.supportAdmin !== true || auth.supportReadOnly !== true) {
    return auth.response || NextResponse.json(
      { success: false, error: "Only a read-only support administrator may request a restriction review." },
      { status: 403 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ success: false, error: "A valid JSON object is required." }, { status: 400 });
  }

  const targetUserId = typeof body.targetUserId === "string" ? body.targetUserId.trim() : "";
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidPattern.test(targetUserId) || reason.length < 10 || reason.length > 2000) {
    return NextResponse.json(
      { success: false, error: "A valid target UUID and reason between 10 and 2000 characters are required." },
      { status: 400 }
    );
  }
  if (targetUserId === auth.user.id) {
    return NextResponse.json({ success: false, error: "Support admins cannot request restriction of their own account." }, { status: 403 });
  }

  const db = getSupabaseAdminClient();
  const { data: target, error: targetError } = await db
    .from("profiles")
    .select("id,role,is_admin,is_admin_account,is_banned,is_suspended,is_restricted,status,account_status")
    .eq("id", targetUserId)
    .maybeSingle();

  if (targetError) {
    console.error("[SUPPORT_RESTRICT_REQUEST] target lookup failed:", targetError.code || "unknown");
    return NextResponse.json({ success: false, error: "Target account could not be verified." }, { status: 503 });
  }
  if (!target) {
    return NextResponse.json({ success: false, error: "Target account not found." }, { status: 404 });
  }

  const { data: adminRecord, error: adminLookupError } = await db
    .from("app_admins")
    .select("user_id")
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (adminLookupError) {
    console.error("[SUPPORT_RESTRICT_REQUEST] admin-target check failed:", adminLookupError.code || "unknown");
    return NextResponse.json({ success: false, error: "Target privileges could not be verified." }, { status: 503 });
  }
  if (target.role === "admin" || target.is_admin === true || target.is_admin_account === true || adminRecord) {
    return NextResponse.json({ success: false, error: "Support admins cannot request changes to administrator accounts." }, { status: 403 });
  }

  const { data: activity, error: activityError } = await db
    .from("support_admin_activity")
    .insert({
      support_admin_id: auth.user.id,
      emergency_session_id: null,
      action: "REQUEST_USER_RESTRICTION_REVIEW",
      target_type: "user",
      target_id: targetUserId,
      outcome: "attempted",
      details: {
        reason,
        request_type: "restriction_review",
        requires_full_admin_approval: true,
        account_changed: false,
        advertisements_changed: false,
      },
    })
    .select("id,created_at")
    .single();

  if (activityError || !activity) {
    console.error("[SUPPORT_RESTRICT_REQUEST] activity insert failed:", activityError?.code || "unknown");
    return NextResponse.json({ success: false, error: "The restriction review request could not be audited." }, { status: 503 });
  }

  return NextResponse.json({
    success: true,
    requested: true,
    restricted: false,
    activityId: activity.id,
    createdAt: activity.created_at,
    message: "The restriction request was logged for full-administrator review. No account or advertisement changes were made.",
  }, { status: 202, headers: { "Cache-Control": "no-store, max-age=0" } });
}
