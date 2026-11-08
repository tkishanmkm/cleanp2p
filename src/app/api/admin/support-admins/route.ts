import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { verifyServerAdmin } from "@/lib/server-admin-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await verifyServerAdmin(req);
  if (!auth.authorized || !auth.adminId || auth.supportAdmin) {
    return auth.response || NextResponse.json({ success: false, error: "Full administrator access required." }, { status: 403 });
  }

  const db = getSupabaseAdminClient();
  const [{ data: grants, error }, { data: activity, error: activityError }] = await Promise.all([
    db.from("support_admin_grants")
      .select("user_id, is_enabled, emergency_uses_granted, emergency_uses_consumed, emergency_uses_remaining, granted_by_admin_id, created_at, updated_at")
      .order("created_at", { ascending: false }),
    db.from("support_admin_activity")
      .select("id, support_admin_id, emergency_session_id, action, target_type, target_id, outcome, details, created_at")
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  if (error || activityError) {
    console.error("[SUPPORT_ADMIN_MANAGEMENT] list/activity query failed:", error?.code || activityError?.code || "unknown");
    return NextResponse.json({ success: false, error: "Support-admin data is unavailable." }, { status: 503 });
  }
  return NextResponse.json({ success: true, supportAdmins: grants || [], activity: activity || [] });
}

export async function POST(req: NextRequest) {
  const auth = await verifyServerAdmin(req);
  if (!auth.authorized || !auth.adminId || auth.supportAdmin) {
    return auth.response || NextResponse.json({ success: false, error: "Full administrator access required." }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json({ success: false, error: "A valid JSON object is required." }, { status: 400 });
  }

  const { userId, enabled, addEmergencyUses } = body;
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (typeof userId !== "string" || !uuidPattern.test(userId) ||
      typeof enabled !== "boolean" ||
      !Number.isInteger(addEmergencyUses) || addEmergencyUses < 0 || addEmergencyUses > 1000) {
    return NextResponse.json({ success: false, error: "Invalid support-admin configuration." }, { status: 400 });
  }

  const db = getSupabaseAdminClient();
  const { data, error } = await db.rpc("configure_support_admin", {
    p_user_id: userId,
    p_admin_id: auth.adminId,
    p_enable: enabled,
    p_add_emergency_uses: addEmergencyUses,
  });
  if (error || !data || data.success !== true) {
    console.error("[SUPPORT_ADMIN_MANAGEMENT] configure RPC failed:", error?.code || "unsuccessful_rpc_result");
    return NextResponse.json({ success: false, error: "Support-admin configuration was rejected." }, { status: 409 });
  }

  // The database RPC writes this audit row in the same transaction as the
  // grant update, so no successful access change can commit without its audit.
  return NextResponse.json({ success: true });
}
