"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyServerAdmin } from "@/lib/server-admin-auth";
import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/audit";

export async function resolveTradeAction(tradeId: string, decision: "release" | "refund") {
  const auth = await verifyServerAdmin();
  if (!auth.authorized || !auth.adminId) {
    return { success: false, error: "Unauthorized: Administrator privileges required." };
  }

  const adminId = auth.adminId;
  const adminSupabase = createAdminClient();
  const targetStatus = decision === "release" ? "completed" : "cancelled";

  // 1. Invoke authoritative escrow settlement RPCs
  if (decision === "release") {
    const { data: rpcData, error: rpcErr } = await adminSupabase.rpc("release_trade_escrow", {
      p_trade_id: tradeId,
      p_caller_id: adminId,
    });

    if (rpcErr || (rpcData && rpcData.success === false)) {
      const errorMsg = rpcErr?.message || rpcData?.message || "Failed to execute escrow release via canonical RPC.";
      console.error("[resolveTradeAction] release_trade_escrow failure:", errorMsg);
      return { success: false, error: errorMsg };
    }
  } else {
    const { data: rpcData, error: rpcErr } = await adminSupabase.rpc("cancel_p2p_trade", {
      p_trade_id: tradeId,
      p_caller_id: adminId,
      p_reason: "Admin resolved dispute: refund to seller",
    });

    if (rpcErr || (rpcData && rpcData.success === false)) {
      const errorMsg = rpcErr?.message || rpcData?.message || "Failed to execute trade cancellation via canonical RPC.";
      console.error("[resolveTradeAction] cancel_p2p_trade failure:", errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  // 2. Ensure trade status and dispute are updated
  let { error } = await adminSupabase
    .from("trades")
    .update({ 
      status: targetStatus,
      is_disputed: false,
      resolved_at: new Date().toISOString(),
      resolved_by: adminId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tradeId);

  // Fallback if schema does not have resolved_at / resolved_by columns
  if (error && error.message.includes("schema cache")) {
    const fallback = await adminSupabase
      .from("trades")
      .update({ status: targetStatus, is_disputed: false, updated_at: new Date().toISOString() })
      .eq("id", tradeId);
    error = fallback.error;
  }

  if (error) return { success: false, error: error.message };

  // Update associated dispute if any
  await adminSupabase
    .from("disputes")
    .update({
      status: "resolved",
      resolved_by: adminId,
      resolved_at: new Date().toISOString(),
    })
    .eq("trade_id", tradeId)
    .catch(() => null);

  // 3. Record Audit Event with verified admin identity
  await logAdminAction({
    adminId,
    action: "RESOLVE_TRADE_ESCROW",
    targetId: tradeId,
    details: { decision, resolved_status: targetStatus },
  });

  revalidatePath("/adminnarayan/trades");
  revalidatePath("/adminnarayan/dashboard");
  return { success: true };
}

