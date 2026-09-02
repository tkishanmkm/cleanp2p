"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

async function verifyAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Unauthorized");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (profile?.role !== "admin") throw new Error("Unauthorized");
  return user.id;
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

  // 1. Update dispute status
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

  // 2. Mark trade status as resolved/completed
  const { error: tradeError } = await adminSupabase
    .from("trades")
    .update({ status: "resolved" })
    .eq("id", tradeId);

  if (tradeError) throw new Error(`Trade update failed: ${tradeError.message}`);

  revalidatePath("/adminnarayan/disputes");
  revalidatePath("/adminnarayan/dashboard");
}
