"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/audit";

async function getAuthenticatedAdminId() {
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id || null;
}

export async function resolveTradeAction(tradeId: string, decision: "release" | "refund") {
  const adminId = await getAuthenticatedAdminId();
  if (!adminId) return { success: false, error: "Unauthorized" };

  const adminSupabase = createAdminClient();
  const targetStatus = decision === "release" ? "completed" : "cancelled";

  let { error } = await adminSupabase
    .from("trades")
    .update({ 
      status: targetStatus,
      resolved_at: new Date().toISOString(),
      resolved_by: adminId 
    })
    .eq("id", tradeId);

  // Fallback if schema does not have resolved_at / resolved_by columns
  if (error && error.message.includes("schema cache")) {
    const fallback = await adminSupabase
      .from("trades")
      .update({ status: targetStatus })
      .eq("id", tradeId);
    error = fallback.error;
  }

  if (error) return { success: false, error: error.message };

  // Record Audit Event
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
