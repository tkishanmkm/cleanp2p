import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { verifyServerAdmin } from "@/lib/server-admin-auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> | { tradeId: string } }
) {
  try {
    // 1. Mandatory Server-Side Admin Authentication & Authorization
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) {
      return auth.response!;
    }

    const resolvedParams = await params;
    const tradeId = resolvedParams.tradeId;

    if (!tradeId) {
      return NextResponse.json({ success: false, error: "Missing trade ID parameter" }, { status: 400 });
    }

    const supabase = getSupabaseAdminClient();

    // 1. Fetch trade by either id (UUID) or trade_id (e.g. trd_...)
    let trade: any = null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId);

    if (isUuid) {
      const { data } = await supabase.from("trades").select("*").eq("id", tradeId).maybeSingle();
      trade = data;
    }
    if (!trade) {
      const { data } = await supabase.from("trades").select("*").eq("trade_id", tradeId).maybeSingle();
      trade = data;
    }

    if (!trade) {
      return NextResponse.json({ success: false, error: `Trade "${tradeId}" not found in database.` }, { status: 404 });
    }

    // 2. Fetch buyer and seller profiles
    const userIds = [trade.buyer_id, trade.seller_id].filter(Boolean);
    let buyer = null;
    let seller = null;

    if (userIds.length > 0) {
      const { data: profiles } = await supabase.from("profiles").select("*").in("id", userIds);
      (profiles || []).forEach((p: any) => {
        if (p.id === trade.buyer_id) buyer = p;
        if (p.id === trade.seller_id) seller = p;
      });
    }

    // 3. Fetch chat messages from trade_chat_messages and trade_messages
    const [{ data: chatMsgs }, { data: legacyMsgs }] = await Promise.all([
      supabase.from("trade_chat_messages").select("*").eq("trade_id", trade.id).order("created_at", { ascending: true }),
      supabase.from("trade_messages").select("*").eq("trade_id", trade.id).order("created_at", { ascending: true }),
    ]);

    // Merge and deduplicate messages
    const messageList = [...(chatMsgs || [])];
    const seenTexts = new Set(messageList.map((m: any) => `${m.sender_id}:${m.message}:${m.created_at}`));
    (legacyMsgs || []).forEach((lm: any) => {
      const key = `${lm.sender_id}:${lm.message}:${lm.created_at}`;
      if (!seenTexts.has(key)) {
        messageList.push({
          id: lm.id,
          trade_id: lm.trade_id,
          sender_id: lm.sender_id,
          message: lm.message,
          created_at: lm.created_at,
          attachment_url: lm.attachment_url,
        });
        seenTexts.add(key);
      }
    });

    messageList.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

    // 4. Fetch associated dispute if any
    const { data: dispute } = await supabase
      .from("disputes")
      .select("*")
      .eq("trade_id", trade.id)
      .maybeSingle();

    // 5. Check if any moderator has joined this trade
    let hasModeratorJoined = false;
    try {
      const { data: part } = await supabase
        .from("trade_moderator_participations")
        .select("id")
        .eq("trade_id", trade.id)
        .limit(1);
      if (part && part.length > 0) {
        hasModeratorJoined = true;
      }
    } catch (_) {}

    if (!hasModeratorJoined) {
      hasModeratorJoined = messageList.some(
        (m: any) =>
          m.message === "Paxones Moderator joined the trade chat." ||
          (typeof m.message === "string" && m.message.includes("Paxones Moderator joined"))
      );
    }

    return NextResponse.json({
      success: true,
      trade: {
        ...trade,
        buyer,
        seller,
        dispute: dispute || null,
      },
      messages: messageList,
      hasModeratorJoined,
    });
  } catch (err: any) {
    console.error("[API/ADMIN/TRADE] Error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> | { tradeId: string } }
) {
  try {
    // 1. Mandatory Server-Side Admin Authentication & Authorization FIRST
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) {
      return auth.response!;
    }

    const adminEmail = auth.adminEmail || "admin@paxones.com";
    const adminId = auth.adminId || auth.user.id;

    const resolvedParams = typeof (params as any)?.then === "function" ? await params : params;
    const tradeParam = resolvedParams.tradeId;

    if (!tradeParam) {
      return NextResponse.json({ success: false, error: "Missing trade ID parameter" }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    // Note: adminEmail and adminId are NEVER read from body; strictly authoritative from server auth
    const { action, message, reason, interveneAction } = body;
    const supabase = getSupabaseAdminClient();

    // Fetch target trade
    let trade: any = null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeParam);
    if (isUuid) {
      const { data } = await supabase.from("trades").select("*").eq("id", tradeParam).maybeSingle();
      trade = data;
    }
    if (!trade) {
      const { data } = await supabase.from("trades").select("*").eq("trade_id", tradeParam).maybeSingle();
      trade = data;
    }

    if (!trade) {
      return NextResponse.json({ success: false, error: "Trade not found" }, { status: 404 });
    }

    // 1. Moderator Join (Generic system message without exposing admin identity to users)
    if (action === "join") {
      // Check idempotency first: verify if moderator already joined or join message already exists
      let alreadyJoined = false;
      try {
        const { data: existingPart } = await supabase
          .from("trade_moderator_participations")
          .select("id")
          .eq("trade_id", trade.id)
          .maybeSingle();

        if (existingPart) {
          alreadyJoined = true;
        }
      } catch (_) {}

      if (!alreadyJoined) {
        const { data: existingMsg } = await supabase
          .from("trade_messages")
          .select("id")
          .eq("trade_id", trade.id)
          .eq("message", "Paxones Moderator joined the trade chat.")
          .limit(1);

        if (existingMsg && existingMsg.length > 0) {
          alreadyJoined = true;
        }
      }

      if (alreadyJoined) {
        return NextResponse.json({
          success: true,
          message: "Paxones Moderator has already joined this trade chat.",
          alreadyJoined: true,
        });
      }

      // Record moderator participation
      try {
        await supabase.from("trade_moderator_participations").upsert(
          {
            trade_id: trade.id,
            moderator_id: adminId,
            joined_at: new Date().toISOString(),
          },
          { onConflict: "trade_id,moderator_id" }
        );
      } catch (partErr) {
        console.warn("[Moderator Join] Participation table notice:", partErr);
      }

      const exactJoinMessage = "Paxones Moderator joined the trade chat.";
      const systemUuid = "00000000-0000-0000-0000-000000000000";
      const nowIso = new Date().toISOString();

      // Insert into trade_messages (authoritative stream read by buyer/seller chat client)
      await supabase.from("trade_messages").insert({
        trade_id: trade.id,
        sender_id: systemUuid,
        sender_username: "Paxones Moderator",
        message: exactJoinMessage,
        is_moderator: true,
        visibility: "all",
        created_at: nowIso,
      });

      // Also insert into trade_chat_messages for compatibility
      await supabase.from("trade_chat_messages").insert({
        trade_id: trade.id,
        sender_id: systemUuid,
        message: exactJoinMessage,
        is_system_message: true,
        created_at: nowIso,
      });

      // Internal audit log preserves actual admin identity
      await supabase.from("admin_audit_logs").insert({
        admin_id: adminId,
        admin_email: adminEmail,
        action: "TRADE_MODERATOR_JOINED",
        target_user_id: trade.buyer_id,
        target_id: trade.id,
        details: {
          trade_id: trade.id,
          dispute_id: trade.dispute?.id || null,
          admin_id: adminId,
          admin_email: adminEmail,
          timestamp: nowIso,
        },
        created_at: nowIso,
      });

      // Notify both participants
      const participantIds = [trade.buyer_id, trade.seller_id].filter(Boolean);
      for (const pid of participantIds) {
        try {
          await supabase.from("notifications").insert({
            user_id: pid,
            title: "Moderator Joined Trade",
            message: "Paxones Moderator joined the trade chat.",
            link: `/trade/${trade.id}`,
            is_read: false,
            created_at: nowIso,
          });
        } catch (notifErr) {
          console.warn("Moderator join notification insert error:", notifErr);
        }
      }

      return NextResponse.json({
        success: true,
        message: "Paxones Moderator joined the trade chat.",
        alreadyJoined: false,
      });
    }

    // 2. Moderator Message (Displayed strictly as Paxones Moderator without admin identity)
    if (action === "message") {
      if (!message || !message.trim()) {
        return NextResponse.json({ success: false, error: "Message cannot be empty" }, { status: 400 });
      }

      const cleanMessage = message.trim();
      const nowIso = new Date().toISOString();

      // Insert into trade_messages with is_moderator: true and sender_username: Paxones Moderator
      await supabase.from("trade_messages").insert({
        trade_id: trade.id,
        sender_id: adminId,
        sender_username: "Paxones Moderator",
        message: cleanMessage,
        is_moderator: true,
        visibility: "all",
        created_at: nowIso,
      });

      // Also insert into trade_chat_messages
      await supabase.from("trade_chat_messages").insert({
        trade_id: trade.id,
        sender_id: adminId,
        message: cleanMessage,
        is_system_message: false,
        created_at: nowIso,
      });

      // Also notify both trade participants in Activity Center
      const participantIds = [trade.buyer_id, trade.seller_id].filter(Boolean);
      for (const pid of participantIds) {
        try {
          await supabase.from("notifications").insert({
            user_id: pid,
            title: "New Moderator Message",
            message: `Paxones Moderator: "${cleanMessage.slice(0, 100)}"`,
            link: `/trade/${trade.id}`,
            is_read: false,
            created_at: nowIso,
          });
        } catch (notifErr) {
          console.warn("Moderator message notification insert error:", notifErr);
        }
      }

      return NextResponse.json({ success: true, message: "Moderator message sent" });
    }

    // 3. Moderator Escrow Intervention (Release or Refund)
    if (action === "intervene") {
      const isRelease = interveneAction === "release";
      const newStatus = isRelease ? "completed" : "cancelled";
      const cryptoAsset = (trade.crypto || trade.crypto_currency || "USDT").toUpperCase();
      const cryptoAmount = parseFloat(trade.amount || trade.crypto_amount) || 0;
      const interventionReason = reason?.trim() || `Administrative moderator ${isRelease ? "release to buyer" : "refund to seller"}`;

      // Invoke canonical settlement RPCs first
      let rpcExecuted = false;
      let rpcErrorMsg: string | null = null;

      if (isRelease) {
        const { data: rpcData, error: rpcErr } = await supabase.rpc("release_trade_escrow", {
          p_trade_id: trade.id,
          p_caller_id: adminId,
        });

        if (rpcErr || (rpcData && rpcData.success === false)) {
          rpcErrorMsg = rpcErr?.message || rpcData?.message || "Failed to release trade escrow via canonical RPC.";
          console.warn("[API/ADMIN/TRADE_ACTION] release_trade_escrow RPC notice:", rpcErrorMsg);
        } else {
          rpcExecuted = true;
        }
      } else {
        const { data: rpcData, error: rpcErr } = await supabase.rpc("cancel_p2p_trade", {
          p_trade_id: trade.id,
          p_caller_id: adminId,
          p_reason: interventionReason,
        });

        if (rpcErr || (rpcData && rpcData.success === false)) {
          rpcErrorMsg = rpcErr?.message || rpcData?.message || "Failed to cancel trade via canonical RPC.";
          console.warn("[API/ADMIN/TRADE_ACTION] cancel_p2p_trade RPC notice:", rpcErrorMsg);
        } else {
          rpcExecuted = true;
        }
      }

      // If canonical RPC was not successful, fail closed immediately to prevent desynchronization
      if (!rpcExecuted) {
        return NextResponse.json(
          {
            success: false,
            error: rpcErrorMsg || `Failed to execute ${isRelease ? "escrow release" : "escrow refund"} via canonical settlement RPC.`,
          },
          { status: 400 }
        );
      }

      // Update trade status and mark dispute resolved
      await supabase
        .from("trades")
        .update({
          status: newStatus,
          is_disputed: false,
          updated_at: new Date().toISOString(),
        })
        .eq("id", trade.id);

      await supabase
        .from("disputes")
        .update({
          status: "resolved",
          reason: interventionReason,
          resolved_at: new Date().toISOString(),
        })
        .eq("trade_id", trade.id);

      // Insert standardized user-facing moderator decision message
      const decisionMsg = isRelease
        ? `Paxones Moderator\n\nEscrow released to the buyer:\n${cryptoAmount} ${cryptoAsset}\n\nReason: ${interventionReason}`
        : `Paxones Moderator\n\nEscrow refunded to the seller:\n${cryptoAmount} ${cryptoAsset}\n\nReason: ${interventionReason}`;

      await supabase.from("trade_chat_messages").insert({
        trade_id: trade.id,
        sender_id: "00000000-0000-0000-0000-000000000000",
        message: decisionMsg,
      });

      // Log internal audit trail with authoritative admin identity
      await supabase.from("admin_audit_logs").insert({
        admin_id: adminId,
        admin_email: adminEmail,
        action: isRelease ? "ESCROW_RELEASED_BY_ADMIN" : "ESCROW_REFUNDED_BY_ADMIN",
        target_user_id: isRelease ? trade.buyer_id : trade.seller_id,
        target_id: trade.id,
        details: {
          trade_id: trade.id,
          action: interveneAction,
          amount: cryptoAmount,
          currency: cryptoAsset,
          reason: interventionReason,
          rpc_executed: rpcExecuted,
          date: new Date().toISOString(),
        },
      });

      return NextResponse.json({
        success: true,
        message: `Successfully executed escrow ${isRelease ? "release" : "refund"}.`,
      });
    }

    return NextResponse.json({ success: false, error: "Invalid action" }, { status: 400 });
  } catch (err: any) {
    console.error("[API/ADMIN/TRADE_ACTION] Error:", err);
    return NextResponse.json(
      { success: false, error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

