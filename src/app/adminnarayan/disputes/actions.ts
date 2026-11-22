"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyServerAdmin } from "@/lib/server-admin-auth";
import { revalidatePath } from "next/cache";

async function verifyAdmin() {
  const auth = await verifyServerAdmin();
  if (!auth.authorized || !auth.adminId) {
    throw new Error("Unauthorized: Administrator privileges required.");
  }
  return {
    adminId: auth.adminId,
    adminEmail: auth.adminEmail || auth.user.email || null,
  };
}

export async function resolveDispute({
  disputeId,
  tradeId,
  winnerId,
  resolutionReason,
}: {
  disputeId: string;
  tradeId: string;
  winnerId: string;
  resolutionReason: string;
}) {
  const { adminId, adminEmail } = await verifyAdmin();
  const adminSupabase = createAdminClient();

  const cleanReason = String(resolutionReason || "").trim();
  if (cleanReason.length > 2000) throw new Error("Resolution notes cannot exceed 2,000 characters.");

  const { data: trade, error: tradeError } = await adminSupabase
    .from("trades")
    .select("id, buyer_id, seller_id")
    .eq("id", tradeId)
    .maybeSingle();
  if (tradeError || !trade) throw new Error(`Trade not found: ${tradeError?.message || "Invalid trade ID"}`);

  const { data: dispute, error: disputeError } = await adminSupabase
    .from("disputes")
    .select("id, trade_id, status")
    .eq("id", disputeId)
    .maybeSingle();
  if (disputeError || !dispute) throw new Error(`Dispute not found: ${disputeError?.message || "Invalid dispute ID"}`);
  if (String(dispute.trade_id) !== String(trade.id)) throw new Error("Dispute does not belong to the supplied trade.");

  const isBuyerWinner = winnerId === String(trade.buyer_id);
  const isSellerWinner = winnerId === String(trade.seller_id);
  if (!isBuyerWinner && !isSellerWinner) throw new Error("Winner must be either the trade buyer or seller.");

  const { data, error } = await adminSupabase.rpc("resolve_trade_dispute_with_audit", {
    p_dispute_id: disputeId,
    p_resolution: isBuyerWinner ? "RELEASE" : "CANCEL",
    p_winner_id: winnerId,
    p_caller_id: adminId,
    p_admin_email: adminEmail,
    p_notes: cleanReason || null,
  });

  if (error || !data || data.success !== true) {
    throw new Error(error?.message || data?.message || "Atomic dispute settlement failed.");
  }

  revalidatePath("/adminnarayan/disputes");
  revalidatePath("/adminnarayan/dashboard");
  return { success: true, data };
}