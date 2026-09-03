import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> | { tradeId: string } }
) {
  try {
    const resolvedParams = typeof (params as any)?.then === "function" ? await params : params;
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

    return NextResponse.json({
      success: true,
      trade: {
        ...trade,
        buyer,
        seller,
        dispute: dispute || null,
      },
      messages: messageList,
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
    const resolvedParams = typeof (params as any)?.then === "function" ? await params : params;
    const tradeParam = resolvedParams.tradeId;

    const body = await req.json();
    const { action, message, adminEmail = "admin@paxones.com", reason, interveneAction } = body;
    const supabase = getSupabaseAdminClient();

    // Fetch trade
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

    // 1. Moderator Join (Step 20.2: Generic system message without any admin identity)
    if (action === "join") {
      const joinMsg = "Paxones Moderator joined the trade.";
      await supabase.from("trade_chat_messages").insert({
        trade_id: trade.id,
        sender_id: "00000000-0000-0000-0000-000000000000",
        message: joinMsg,
      });

      // Internal audit log preserves actual admin identity
      await supabase.from("admin_audit_logs").insert({
        admin_email: adminEmail,
        action: "MODERATOR_JOINED_TRADE",
        target_user_id: trade.buyer_id,
        details: { trade_id: trade.id, date: new Date().toISOString() },
      });

      return NextResponse.json({ success: true, message: "Joined trade chat as moderator" });
    }

    // 2. Moderator Message (Step 20.1: Displayed strictly as Paxones Moderator without admin identity)
    if (action === "message") {
      if (!message || !message.trim()) {
        return NextResponse.json({ success: false, error: "Message cannot be empty" }, { status: 400 });
      }

      // Stored cleanly as moderator message; user-facing identity is Paxones Moderator
      await supabase.from("trade_chat_messages").insert({
        trade_id: trade.id,
        sender_id: "00000000-0000-0000-0000-000000000000",
        message: message.trim(),
      });

      return NextResponse.json({ success: true, message: "Moderator message sent" });
    }

    // 3. Moderator Escrow Intervention (Release or Refund - Step 20.3, 20.12, 20.13)
    if (action === "intervene") {
      const isRelease = interveneAction === "release";
      const newStatus = isRelease ? "completed" : "cancelled";
      const cryptoAsset = (trade.crypto || trade.crypto_currency || "USDT").toUpperCase();
      const cryptoAmount = parseFloat(trade.amount) || 0;
      const interventionReason = reason?.trim() || `Administrative moderator ${isRelease ? "release to buyer" : "refund to seller"}`;

      // Update trade status
      await supabase
        .from("trades")
        .update({
          status: newStatus,
          is_disputed: false,
        })
        .eq("id", trade.id);

      // Update associated dispute if exists (without exposing admin email to users)
      await supabase
        .from("disputes")
        .update({
          status: "resolved",
          reason: interventionReason,
        })
        .eq("trade_id", trade.id);

      let feeCharged = 0;

      // Execute balance updates & Escrow Fee Rules
      if (isRelease) {
        // Fee calculation: 1% platform fee (or existing trade.escrow_fee)
        const standardFeePercent = 0.01;
        const calculatedFee = Number(trade.escrow_fee || (cryptoAmount * standardFeePercent).toFixed(6));
        feeCharged = calculatedFee;

        // Ensure fee is only charged once by checking existing fee transactions for this trade
        const { data: existingFeeTx } = await supabase
          .from("wallet_transactions")
          .select("id")
          .eq("trade_id", trade.id)
          .eq("tx_type", "escrow_fee")
          .maybeSingle();

        if (!existingFeeTx && calculatedFee > 0) {
          // Deduct escrow fee from the user whose crypto was locked (seller)
          await supabase.rpc("admin_adjust_balance", {
            p_admin_email: adminEmail,
            p_user_id: trade.seller_id,
            p_currency: cryptoAsset,
            p_type: "subtract",
            p_amount: calculatedFee,
          });

          // Insert immutable financial ledger record for escrow fee
          await supabase.from("wallet_transactions").insert({
            user_id: trade.seller_id,
            trade_id: trade.id,
            tx_type: "escrow_fee",
            currency: cryptoAsset,
            asset_symbol: cryptoAsset,
            amount: calculatedFee,
            status: "completed",
            metadata: {
              original_escrow_amount: cryptoAmount,
              final_released_amount: cryptoAmount,
              fee_destination: "platform_custody",
              final_outcome: "moderator_release_to_buyer",
              date: new Date().toISOString(),
            },
            created_at: new Date().toISOString(),
          });
        }

        // Release full escrow funds to buyer
        await supabase.rpc("admin_adjust_balance", {
          p_admin_email: adminEmail,
          p_user_id: trade.buyer_id,
          p_currency: cryptoAsset,
          p_type: "add",
          p_amount: cryptoAmount,
        });

        // Insert standardized user-facing moderator decision message
        const releaseDecisionMsg = `Paxones Moderator\n\nEscrow released to the buyer:\n${cryptoAmount} ${cryptoAsset}\n\nReason: ${interventionReason}`;
        await supabase.from("trade_chat_messages").insert({
          trade_id: trade.id,
          sender_id: "00000000-0000-0000-0000-000000000000",
          message: releaseDecisionMsg,
        });
      } else {
        // SELLER REFUND — NO ESCROW FEE (Step 20.12)
        // Full eligible escrow amount returned to seller. Escrow fee is strictly 0.
        feeCharged = 0;

        // Refund full escrow funds back to seller
        await supabase.rpc("admin_adjust_balance", {
          p_admin_email: adminEmail,
          p_user_id: trade.seller_id,
          p_currency: cryptoAsset,
          p_type: "add",
          p_amount: cryptoAmount,
        });

        // Insert standardized user-facing moderator decision message
        const refundDecisionMsg = `Paxones Moderator\n\nEscrow refunded to the seller:\n${cryptoAmount} ${cryptoAsset}\n\nReason: ${interventionReason}`;
        await supabase.from("trade_chat_messages").insert({
          trade_id: trade.id,
          sender_id: "00000000-0000-0000-0000-000000000000",
          message: refundDecisionMsg,
        });
      }

      // Log internal audit trail with actual admin identity (never visible to users)
      await supabase.from("admin_audit_logs").insert({
        admin_email: adminEmail,
        action: isRelease ? "ESCROW_RELEASED_BY_ADMIN" : "ESCROW_REFUNDED_BY_ADMIN",
        target_user_id: isRelease ? trade.buyer_id : trade.seller_id,
        details: {
          trade_id: trade.id,
          action: interveneAction,
          amount: cryptoAmount,
          currency: cryptoAsset,
          escrow_fee: feeCharged,
          reason: interventionReason,
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
