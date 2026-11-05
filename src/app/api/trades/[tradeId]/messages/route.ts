import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyServerAdmin } from "@/lib/server-admin-auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> },
) {
  try {
    const { tradeId } = await params;
    if (typeof tradeId !== "string" || !tradeId.trim()) {
      return NextResponse.json({ success: false, error: "Trade ID is required." }, { status: 400 });
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ success: false, error: "Authentication required." }, { status: 401 });
    }

    const adminAuth = await verifyServerAdmin(req, { allowSupportReadOnly: true });
    const isAdminViewer = adminAuth.authorized;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId);
    if (!isUuid && !/^[a-zA-Z0-9_-]{1,64}$/.test(tradeId)) {
      return NextResponse.json({ success: false, error: "Invalid trade ID." }, { status: 400 });
    }

    let tradeQuery = supabaseAdmin.from("trades").select("id, trade_id, buyer_id, seller_id");
    tradeQuery = isUuid
      ? tradeQuery.or("id.eq." + tradeId + ",trade_id.eq." + tradeId)
      : tradeQuery.eq("trade_id", tradeId);
    const { data: trade, error: tradeError } = await tradeQuery.maybeSingle();

    if (tradeError) {
      console.error("[TRADE_MESSAGES] trade lookup failed:", tradeError.code || "unknown");
      return NextResponse.json({ success: false, error: "Trade messages are unavailable." }, { status: 503 });
    }
    if (!trade) {
      return NextResponse.json({ success: false, error: "Trade not found." }, { status: 404 });
    }

    const isParticipant = trade.buyer_id === user.id || trade.seller_id === user.id;
    if (!isAdminViewer && !isParticipant) {
      return NextResponse.json({ success: false, error: "You are not authorized to view this trade." }, { status: 403 });
    }

    const { data: rows, error: messageError } = await supabaseAdmin
      .from("trade_messages")
      .select("id, trade_id, sender_id, sender_username, message, media_url, media_type, visibility, is_moderator, created_at")
      .eq("trade_id", String(trade.id))
      .order("created_at", { ascending: true })
      .limit(200);

    if (messageError) {
      console.error("[TRADE_MESSAGES] message query failed:", messageError.code || "unknown");
      return NextResponse.json({ success: false, error: "Trade messages are unavailable." }, { status: 503 });
    }

    const isFullAdminViewer = adminAuth.authorized && adminAuth.supportAdmin !== true && adminAuth.supportReadOnly !== true;
    const visibleMessages = (rows || []).filter((row: any) =>
      isFullAdminViewer || row.visibility !== "moderator_only" || row.sender_id === user.id
    );

    return NextResponse.json({
      success: true,
      messages: visibleMessages,
      isAdminViewer,
      isParticipant,
    });
  } catch {
    console.error("[TRADE_MESSAGES] unexpected read failure");
    return NextResponse.json({ success: false, error: "Trade messages are unavailable." }, { status: 500 });
  }
}
