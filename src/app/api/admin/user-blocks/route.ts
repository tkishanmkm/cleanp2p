import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { verifyServerAdmin } from "@/lib/server-admin-auth";
import { adminUnblockUserBlock } from "@/lib/platform-bulk-actions";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req, { allowSupportReadOnly: true });
    if (!auth.authorized) return auth.response!;
    if (auth.supportAdmin === true || auth.supportReadOnly === true) {
      return NextResponse.json(
        { success: false, error: 'Full administrator access is required to view platform-wide user block records.', blocks: [] },
        { status: 403 }
      );
    }

    const supabase = getSupabaseAdminClient();

    // Query user_blocks with joined blocker and blocked profiles
    const { data: blocks, error } = await supabase
      .from("user_blocks")
      .select(`
        id,
        blocker_id,
        blocked_id,
        created_at
      `)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("[GET /api/admin/user-blocks] Error:", error);
      return NextResponse.json({ success: false, error: error.message, blocks: [] }, { status: 500 });
    }

    // Fetch user profiles for mapping
    const userIds = Array.from(
      new Set(
        (blocks || [])
          .flatMap((b: any) => [b.blocker_id, b.blocked_id])
          .filter(Boolean)
      )
    );

    let profileMap = new Map<string, any>();
    if (userIds.length > 0) {
      const { data: profs } = await supabase
        .from("profiles")
        .select("id, username, full_name, email, status")
        .in("id", userIds);

      (profs || []).forEach((p: any) => {
        profileMap.set(p.id, p);
      });
    }

    const enrichedBlocks = (blocks || []).map((b: any) => {
      const blocker = profileMap.get(b.blocker_id) || { id: b.blocker_id, username: "Unknown", email: "N/A" };
      const blocked = profileMap.get(b.blocked_id) || { id: b.blocked_id, username: "Unknown", email: "N/A" };

      return {
        id: b.id,
        blockerId: b.blocker_id,
        blockedId: b.blocked_id,
        blockerUsername: blocker.username || blocker.full_name || blocker.email,
        blockerEmail: blocker.email || "N/A",
        blockedUsername: blocked.username || blocked.full_name || blocked.email,
        blockedEmail: blocked.email || "N/A",
        createdAt: b.created_at,
        isActive: true,
      };
    });

    return NextResponse.json({
      success: true,
      blocks: enrichedBlocks,
      totalCount: enrichedBlocks.length,
    });
  } catch (err: any) {
    console.error("[GET /api/admin/user-blocks] Internal error:", err);
    return NextResponse.json({ success: false, error: err.message, blocks: [] }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) {
      return auth.response!;
    }

    const body = await req.json().catch(() => ({}));
    const { blockId, blockerId, blockedId } = body;

    const adminEmail = auth.adminEmail || "admin@paxones.com";
    const adminId = auth.adminId || auth.user.id;

    if (!blockId && (!blockerId || !blockedId)) {
      return NextResponse.json({ success: false, error: "Missing required block identification." }, { status: 400 });
    }

    const res = await adminUnblockUserBlock(blockId, blockerId, blockedId, adminId, adminEmail);
    if (!res.success) {
      return NextResponse.json({ success: false, error: res.error || "Failed to unblock user." }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: "User successfully unblocked by administrator.",
    });
  } catch (err: any) {
    console.error("[POST /api/admin/user-blocks] Internal error:", err);
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
