"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

// Helper to verify caller is an admin
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
}

export async function toggleUserBanStatus(userId: string, isBanned: boolean) {
  await verifyAdmin();
  const adminSupabase = createAdminClient();

  const { error } = await adminSupabase
    .from("profiles")
    .update({ is_banned: isBanned })
    .eq("id", userId);

  if (error) throw new Error(error.message);
  revalidatePath("/adminnarayan/users");
}

export async function updateUserBalance(userId: string, newBalance: number) {
  await verifyAdmin();
  const adminSupabase = createAdminClient();

  const { error } = await adminSupabase
    .from("profiles")
    .update({ wallet_balance: newBalance })
    .eq("id", userId);

  if (error) throw new Error(error.message);
  revalidatePath("/adminnarayan/users");
}
