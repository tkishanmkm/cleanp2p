"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyServerAdmin } from "@/lib/server-admin-auth";
import { revalidatePath } from "next/cache";

export async function resolveTradeAction(tradeId: string, decision: "release" | "refund") {
  const auth = await verifyServerAdmin();
  if (!auth.authorized || !auth.adminId) {
    return { success: false, error: "Unauthorized: Administrator privileges required." };
  }
  if (!tradeId || !["release", "refund"].includes(decision)) {
    return { success: false, error: "Invalid trade intervention parameters." };
  }

  const adminSupabase = createAdminClient();
  const { data, error } = await adminSupabase.rpc("admin_intervene_trade_escrow", {
    p_trade_id: tradeId,
    p_action: decision,
    p_caller_id: auth.adminId,
    p_admin_email: auth.adminEmail || auth.user.email || null,
    p_reason: decision === "release" ? "Administrator trade intervention: release to buyer" : "Administrator trade intervention: refund to seller",
  });

  if (error || !data || data.success !== true) {
    const errorMessage = error?.message || data?.message || "Atomic trade intervention failed.";
    console.error("[resolveTradeAction] Atomic intervention failed:", errorMessage);
    return { success: false, error: errorMessage };
  }

  revalidatePath("/adminnarayan/trades");
  revalidatePath("/adminnarayan/dashboard");
  revalidatePath("/adminnarayan/disputes");
  return { success: true, data };
}