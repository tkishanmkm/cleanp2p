import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { verifyServerAdmin } from "@/lib/server-admin-auth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await verifyServerAdmin(req, { allowSupportReadOnly: true });
  if (!auth.authorized || !auth.user) {
    return auth.response || NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 });
  }

  const db = getSupabaseAdminClient();
  const { data: grant, error: grantError } = await db
    .from("support_admin_grants")
    .select("is_enabled, emergency_uses_granted, emergency_uses_consumed, emergency_uses_remaining")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (grantError) {
    console.error("[SUPPORT_ADMIN_STATUS] grant lookup failed:", grantError.code || "unknown");
    return NextResponse.json({ success: false, error: "Support-admin status is unavailable." }, { status: 503 });
  }

  if (!grant || !grant.is_enabled) {
    return NextResponse.json({ success: true, isSupportAdmin: false, emergencyActive: false });
  }

  const { data: session, error: sessionError } = await db
    .from("support_admin_emergency_sessions")
    .select("id, activated_at, expires_at")
    .eq("support_admin_id", auth.user.id)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("activated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (sessionError) {
    console.error("[SUPPORT_ADMIN_STATUS] session lookup failed:", sessionError.code || "unknown");
    return NextResponse.json({ success: false, error: "Emergency-mode status is unavailable." }, { status: 503 });
  }

  return NextResponse.json({
    success: true,
    isSupportAdmin: true,
    emergencyActive: Boolean(session),
    emergencySessionId: session?.id ?? null,
    emergencyExpiresAt: session?.expires_at ?? null,
    usesGranted: grant.emergency_uses_granted,
    usesConsumed: grant.emergency_uses_consumed,
    usesRemaining: grant.emergency_uses_remaining,
    supportReadOnly: !session,
  });
}
