"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyServerAdmin } from "@/lib/server-admin-auth";
import { revalidatePath } from "next/cache";

async function verifyAdmin() {
  const auth = await verifyServerAdmin();
  if (!auth.authorized || !auth.adminId) {
    throw new Error("Unauthorized: Administrator privileges required.");
  }
  return auth.adminId;
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
  const adminId = await verifyAdmin();
  const adminSupabase = createAdminClient();

  // 1. Fetch trade record to verify counterparties
  const { data: trade, error: tradeFetchError } = await adminSupabase
    .from("trades")
    .select("id, buyer_id, seller_id")
    .eq("id", tradeId)
    .single();

  if (tradeFetchError || !trade) {
    throw new Error(`Trade not found: ${tradeFetchError?.message || 'Invalid trade ID'}`);
  }

  // 2. Perform canonical financial settlement
  if (winnerId === trade.seller_id) {
    // Seller wins: atomic cancellation and locked escrow refund to seller
    const { data: rpcData, error: rpcError } = await adminSupabase.rpc('cancel_p2p_trade', {
      p_trade_id: tradeId,
      p_caller_id: adminId,
    });

    if (rpcError || (rpcData && !rpcData.success)) {
      const errorMsg = rpcError?.message || rpcData?.message || 'Failed to cancel trade and refund escrow.';
      throw new Error(`Cancellation settlement failed: ${errorMsg}`);
    }
  } else if (winnerId === trade.buyer_id) {
    // Buyer wins: atomic escrow release and credit to buyer
    const { data: rpcData, error: rpcError } = await adminSupabase.rpc('release_trade_escrow', {
      p_trade_id: tradeId,
      p_caller_id: adminId,
    });

    if (rpcError || (rpcData && !rpcData.success)) {
      const errorMsg = rpcError?.message || rpcData?.message || 'Failed to release escrow to buyer.';
      throw new Error(`Escrow release settlement failed: ${errorMsg}`);
    }
  } else {
    throw new Error('Invalid winner: winner must be either trade buyer or seller.');
  }

  // 3. Update dispute status only after successful financial settlement
  const { error: disputeError } = await adminSupabase
    .from("disputes")
    .update({
      status: "resolved",
      winner_id: winnerId,
      resolution_reason: resolutionReason,
      resolved_by: adminId,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", disputeId);

  if (disputeError) throw new Error(`Dispute update failed: ${disputeError.message}`);

  revalidatePath("/adminnarayan/disputes");
  revalidatePath("/adminnarayan/dashboard");
}
