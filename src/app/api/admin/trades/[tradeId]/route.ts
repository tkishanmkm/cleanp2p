import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";
import { verifyServerAdmin } from "@/lib/server-admin-auth";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> }
) {
  try {
    // 1. Mandatory Server-Side Admin Authentication & Authorization
    const auth = await verifyServerAdmin(req, { allowSupportReadOnly: true });
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
      const { data: profiles } = await supabase.from("profiles").select("id, username, display_name, full_name, email, role, status, is_banned, is_suspended, is_restricted, account_status, country, avatar_url, photo_url, created_at, is_verified, id_verified, kyc_status").in("id", userIds);
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
    const messageList: Array<{ id: any; trade_id: any; sender_id: any; message: any; attachment_url?: string | null; visibility?: string | null; created_at: any }> = [...(chatMsgs || [])];
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
          visibility: lm.visibility || null,
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

    const supportSafeProfile = (profile: any) => profile ? ({
      id: profile.id,
      username: profile.username,
      display_name: profile.display_name,
      full_name: profile.full_name,
      avatar_url: profile.avatar_url,
      photo_url: profile.photo_url,
      country: profile.country,
      created_at: profile.created_at,
    }) : null;

    const supportVisibleMessages = auth.supportAdmin === true
      ? messageList.filter((message: any) => message.visibility !== "moderator_only" || message.sender_id === auth.user?.id)
      : messageList;
    const supportSafeDispute = auth.supportAdmin === true && dispute ? {
      id: dispute.id,
      trade_id: dispute.trade_id,
      opened_by_id: dispute.opened_by_id,
      status: dispute.status,
      reason: dispute.reason,
      created_at: dispute.created_at,
      updated_at: dispute.updated_at,
      resolved_at: dispute.resolved_at,
    } : dispute;

    const supportSafeTrade = auth.supportAdmin === true ? {
      id: trade.id,
      trade_id: trade.trade_id,
      public_id: trade.public_id,
      buyer_id: trade.buyer_id,
      seller_id: trade.seller_id,
      crypto: trade.crypto,
      crypto_currency: trade.crypto_currency,
      crypto_amount: trade.crypto_amount,
      amount: trade.amount,
      fiat_amount: trade.fiat_amount,
      fiat_currency: trade.fiat_currency,
      payment_method: trade.payment_method,
      status: trade.status,
      escrow_status: trade.escrow_status,
      created_at: trade.created_at,
      paid_at: trade.paid_at,
      marked_paid_at: trade.marked_paid_at,
      expires_at: trade.expires_at,
      completed_at: trade.completed_at,
      released_at: trade.released_at,
      is_disputed: trade.is_disputed,
      dispute_reason: trade.dispute_reason,
    } : trade;

    return NextResponse.json({
      success: true,
      trade: {
        ...supportSafeTrade,
        buyer: auth.supportAdmin === true ? supportSafeProfile(buyer) : buyer,
        seller: auth.supportAdmin === true ? supportSafeProfile(seller) : seller,
        dispute: supportSafeDispute || null,
      },
      messages: supportVisibleMessages,
      hasModeratorJoined,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
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
  { params }: { params: Promise<{ tradeId: string }> }
) {
  try {
    // 1. Mandatory Server-Side Admin Authentication & Authorization FIRST
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) {
      return auth.response!;
    }

    const adminEmail = auth.adminEmail || auth.user.email || null;
    const adminId = auth.adminId || auth.user.id;

    const resolvedParams = await params;
    const tradeParam = resolvedParams.tradeId;

    if (!tradeParam || tradeParam.length > 128) {
      return NextResponse.json({ success: false, error: "A valid trade ID is required" }, { status: 400 });
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: "A valid JSON object is required" }, { status: 400 });
    }
    // Note: adminEmail and adminId are NEVER read from body; strictly authoritative from server auth
    const { action, message, reason, interveneAction } = body;
    if (!["join", "message", "intervene", "mark_paid"].includes(action)) {
      return NextResponse.json({ success: false, error: "Unsupported moderator action" }, { status: 400 });
    }
    // Support-admin sessions may assist with trade chat, but cannot move escrow funds.
    if (action === "mark_paid" && auth.supportAdmin === true) {
      return NextResponse.json(
        { success: false, error: "Support administrators cannot mark trades as paid for participants." },
        { status: 403 },
      );
    }
    if (action === "intervene" && auth.supportAdmin === true) {
      return NextResponse.json(
        { success: false, error: "Support administrators cannot intervene in escrow settlement." },
        { status: 403 },
      );
    }
    if (action === "mark_paid" && (typeof reason !== "string" || reason.trim().length < 10 || reason.trim().length > 1000)) {
      return NextResponse.json({ success: false, error: "A reason between 10 and 1000 characters is required to mark a trade paid administratively." }, { status: 400 });
    }
    if (action === "message" && (typeof message !== "string" || !message.trim() || message.trim().length > 4000)) {
      return NextResponse.json({ success: false, error: "Message must be text between 1 and 4000 characters" }, { status: 400 });
    }
    if (action === "intervene") {
      // This route performs settlement and follow-up bookkeeping in separate
      // operations. Disable the alternate settlement path until one atomic,
      // idempotent RPC owns the financial transition and dispute/audit records.
      return NextResponse.json(
        {
          success: false,
          error: "Escrow intervention is temporarily unavailable until atomic settlement and bookkeeping are verified.",
          code: "DISPUTE_ATOMIC_SETTLEMENT_UNVERIFIED",
        },
        { status: 503 },
      );
    }
    const supabase = getSupabaseAdminClient();

    // Fetch target trade and fail closed on lookup errors before any administrative mutation.
    let trade: any = null;
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeParam);
    if (isUuid) {
      const { data, error } = await supabase.from("trades").select("*").eq("id", tradeParam).maybeSingle();
      if (error) {
        console.error("[API/ADMIN/TRADE_ACTION] Trade lookup failed.", { code: error.code || null });
        return NextResponse.json({ success: false, error: "Unable to verify trade before the requested action." }, { status: 503 });
      }
      trade = data;
    }
    if (!trade) {
      const { data, error } = await supabase.from("trades").select("*").eq("trade_id", tradeParam).maybeSingle();
      if (error) {
        console.error("[API/ADMIN/TRADE_ACTION] Trade lookup by trade_id failed.", { code: error.code || null });
        return NextResponse.json({ success: false, error: "Unable to verify trade before the requested action." }, { status: 503 });
      }
      trade = data;
    }

    if (!trade) {
      return NextResponse.json({ success: false, error: "Trade not found" }, { status: 404 });
    }

    // High-impact administrative mark-paid is allowed only after the route has
    // verified the administrator and signed 2FA session. The database wrapper
    // commits the trade transition and its audit record in one transaction.
    if (action === "mark_paid") {
      const { data: rpcData, error: rpcErr } = await supabase.rpc("admin_mark_trade_paid_authorized", {
        p_trade_id: trade.id,
        p_actor_id: adminId,
        p_actor_email: adminEmail,
        p_reason: reason.trim(),
      });
      if (rpcErr || !rpcData || rpcData.success !== true || rpcData.audit_logged !== true) {
        console.error("[API/ADMIN/TRADE_ACTION] Admin mark-paid rejected.", { code: rpcErr?.code || null });
        return NextResponse.json(
          { success: false, error: "Administrative payment confirmation was rejected or could not be audited." },
          { status: 400 },
        );
      }
      return NextResponse.json({
        success: true,
        message: "Trade marked as paid and administrative audit recorded.",
        data: rpcData,
      });
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
      const { error: joinMessageError } = await supabase.from("trade_messages").insert({
        trade_id: trade.id,
        sender_id: systemUuid,
        sender_username: "Paxones Moderator",
        message: exactJoinMessage,
        is_moderator: true,
        visibility: "all",
        created_at: nowIso,
      });
      if (joinMessageError) {
        console.error("[Moderator Join] Canonical chat message insert failed.", { code: joinMessageError.code || null });
        return NextResponse.json({ success: false, error: "Unable to record the moderator join in trade chat." }, { status: 503 });
      }

      // Also insert into trade_chat_messages for compatibility
      const { error: compatibilityJoinMessageError } = await supabase.from("trade_chat_messages").insert({
        trade_id: trade.id,
        sender_id: systemUuid,
        message: exactJoinMessage,
        is_system_message: true,
        created_at: nowIso,
      });
      if (compatibilityJoinMessageError) {
        console.warn("[Moderator Join] Compatibility chat copy could not be written.", { code: compatibilityJoinMessageError.code || null });
      }

      // Internal audit log preserves actual admin identity
      const { error: joinAuditError } = await supabase.from("admin_audit_logs").insert({
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
      if (joinAuditError) {
        console.error("[Moderator Join] Audit record insert failed.", { code: joinAuditError.code || null, tradeId: trade.id });
        return NextResponse.json({ success: false, error: "Moderator join was recorded, but its audit entry could not be saved. Contact an administrator." }, { status: 503 });
      }

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
      const { error: moderatorMessageError } = await supabase.from("trade_messages").insert({
        trade_id: trade.id,
        sender_id: adminId,
        sender_username: "Paxones Moderator",
        message: cleanMessage,
        is_moderator: true,
        visibility: "all",
        created_at: nowIso,
      });
      if (moderatorMessageError) {
        console.error("[Moderator Message] Canonical chat insert failed.", { code: moderatorMessageError.code || null });
        return NextResponse.json({ success: false, error: "Unable to save the moderator message." }, { status: 503 });
      }

      // Also insert into trade_chat_messages
      const { error: compatibilityMessageError } = await supabase.from("trade_chat_messages").insert({
        trade_id: trade.id,
        sender_id: adminId,
        message: cleanMessage,
        is_system_message: false,
        created_at: nowIso,
      });
      if (compatibilityMessageError) {
        console.warn("[Moderator Message] Compatibility chat copy could not be written.", { code: compatibilityMessageError.code || null });
      }

      const { error: messageAuditError } = await supabase.from("admin_audit_logs").insert({
        admin_id: adminId,
        admin_email: adminEmail,
        action: "TRADE_MODERATOR_MESSAGE_SENT",
        target_user_id: trade.buyer_id,
        target_id: trade.id,
        details: { trade_id: trade.id, message_length: cleanMessage.length },
        created_at: nowIso,
      });
      if (messageAuditError) {
        console.error("[Moderator Message] Audit record insert failed.", { code: messageAuditError.code || null, tradeId: trade.id });
        return NextResponse.json({ success: false, error: "Message was saved, but its audit entry could not be saved. Contact an administrator." }, { status: 503 });
      }

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

        if (rpcErr || !rpcData || rpcData.success !== true) {
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

        if (rpcErr || !rpcData || rpcData.success !== true) {
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

      // Financial settlement has committed in the canonical RPC. The following
      // writes are separate operations, so track each result instead of silently
      // reporting complete success when bookkeeping fails.
      const bookkeepingFailures: string[] = [];

      // The canonical settlement RPC owns the trade-state transition atomically.
      // Do not write status again here: a stale request could overwrite a later state.
      const { data: settledTrade, error: settledTradeReadError } = await supabase
        .from("trades")
        .select("id, status, escrow_status, is_disputed")
        .eq("id", trade.id)
        .maybeSingle();

      const observedStatus = String(settledTrade?.status || "").toLowerCase();
      const observedEscrowStatus = String(settledTrade?.escrow_status || "").toLowerCase();
      const expectedStatus = isRelease ? "completed" : "cancelled";
      if (
        settledTradeReadError ||
        !settledTrade ||
        (observedStatus !== expectedStatus && observedEscrowStatus !== expectedStatus) ||
        settledTrade.is_disputed === true
      ) {
        bookkeepingFailures.push("trade_state_verification");
        console.error("[API/ADMIN/TRADE_ACTION] Canonical trade state could not be verified after settlement.", {
          tradeId: trade.id,
          code: settledTradeReadError?.code || null,
        });
      }

      const { error: disputeUpdateError } = await supabase
        .from("disputes")
        .update({
          status: "resolved",
          reason: interventionReason,
          resolved_at: new Date().toISOString(),
        })
        .eq("trade_id", trade.id);

      if (disputeUpdateError) {
        bookkeepingFailures.push("dispute_status");
        console.error("[API/ADMIN/TRADE_ACTION] Dispute status sync failed after settlement.", {
          tradeId: trade.id,
          code: disputeUpdateError.code || null,
        });
      }

      // Insert standardized user-facing moderator decision message
      const decisionMsg = isRelease
        ? `Paxones Moderator\n\nEscrow released to the buyer:\n${cryptoAmount} ${cryptoAsset}\n\nReason: ${interventionReason}`
        : `Paxones Moderator\n\nEscrow refunded to the seller:\n${cryptoAmount} ${cryptoAsset}\n\nReason: ${interventionReason}`;

      const { error: chatMessageError } = await supabase.from("trade_chat_messages").insert({
        trade_id: trade.id,
        sender_id: "00000000-0000-0000-0000-000000000000",
        message: decisionMsg,
      });

      if (chatMessageError) {
        bookkeepingFailures.push("moderator_message");
        console.error("[API/ADMIN/TRADE_ACTION] Moderator message insert failed after settlement.", {
          tradeId: trade.id,
          code: chatMessageError.code || null,
        });
      }

      // Log internal audit trail with authoritative admin identity
      const { error: auditLogError } = await supabase.from("admin_audit_logs").insert({
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

      if (auditLogError) {
        bookkeepingFailures.push("admin_audit_log");
        console.error("[API/ADMIN/TRADE_ACTION] Audit log insert failed after settlement.", {
          tradeId: trade.id,
          code: auditLogError.code || null,
        });
      }

      if (bookkeepingFailures.length > 0) {
        return NextResponse.json({
          success: false,
          settlementSucceeded: true,
          bookkeepingComplete: false,
          error: "Financial settlement succeeded, but some follow-up records failed. Do not retry settlement blindly; reconcile this trade before taking further action.",
          tradeId: trade.id,
          bookkeepingFailures,
        }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        settlementSucceeded: true,
        bookkeepingComplete: true,
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

