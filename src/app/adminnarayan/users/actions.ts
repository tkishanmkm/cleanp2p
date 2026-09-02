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

export async function updateUserRoleAction(userId: string, newRole: "user" | "admin") {
  const adminId = await getAuthenticatedAdminId();
  if (!adminId) return { success: false, error: "Unauthorized" };

  const adminSupabase = createAdminClient();

  const { error } = await adminSupabase
    .from("profiles")
    .update({ 
      role: newRole,
      is_admin_account: newRole === "admin"
    })
    .eq("id", userId);

  if (error) return { success: false, error: error.message };

  // Sync app_admins table
  if (newRole === "admin") {
    await adminSupabase
      .from("app_admins")
      .upsert({ user_id: userId, granted_at: new Date().toISOString() }, { onConflict: "user_id" });
  } else {
    await adminSupabase.from("app_admins").delete().eq("user_id", userId);
  }

  // Record Audit Event
  await logAdminAction({
    adminId,
    action: "UPDATE_USER_ROLE",
    targetId: userId,
    details: { new_role: newRole },
  });

  revalidatePath("/adminnarayan/users");
  revalidatePath("/adminnarayan/dashboard");
  return { success: true };
}

export async function toggleUserSuspensionAction(userId: string, currentSuspendedStatus: boolean) {
  const adminId = await getAuthenticatedAdminId();
  if (!adminId) return { success: false, error: "Unauthorized" };

  const adminSupabase = createAdminClient();
  const newStatus = !currentSuspendedStatus;

  const { error } = await adminSupabase
    .from("profiles")
    .update({ 
      is_suspended: newStatus,
      is_banned: newStatus 
    })
    .eq("id", userId);

  if (error) return { success: false, error: error.message };

  // Record Audit Event
  await logAdminAction({
    adminId,
    action: "TOGGLE_USER_SUSPENSION",
    targetId: userId,
    details: { is_suspended: newStatus },
  });

  revalidatePath("/adminnarayan/users");
  revalidatePath("/adminnarayan/dashboard");
  return { success: true };
}

export async function toggleUserBanStatus(userId: string, isBanned: boolean) {
  const adminId = await getAuthenticatedAdminId();
  if (!adminId) throw new Error("Unauthorized");

  const adminSupabase = createAdminClient();

  const { error } = await adminSupabase
    .from("profiles")
    .update({ is_banned: isBanned, is_suspended: isBanned })
    .eq("id", userId);

  if (error) throw new Error(error.message);

  await logAdminAction({
    adminId,
    action: isBanned ? "BAN_USER" : "UNBAN_USER",
    targetId: userId,
    details: { is_banned: isBanned },
  });

  revalidatePath("/adminnarayan/users");
  revalidatePath("/adminnarayan/dashboard");
}

export async function updateUserBalance(userId: string, newBalance: number) {
  const adminId = await getAuthenticatedAdminId();
  if (!adminId) throw new Error("Unauthorized");

  const adminSupabase = createAdminClient();

  const { error } = await adminSupabase
    .from("profiles")
    .update({ wallet_balance: newBalance })
    .eq("id", userId);

  if (error) throw new Error(error.message);

  await logAdminAction({
    adminId,
    action: "UPDATE_USER_BALANCE",
    targetId: userId,
    details: { new_balance: newBalance },
  });

  revalidatePath("/adminnarayan/users");
}
