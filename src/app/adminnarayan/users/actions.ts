"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyServerAdmin } from "@/lib/server-admin-auth";
import { revalidatePath } from "next/cache";
import { logAdminAction } from "@/lib/audit";

export async function updateUserRoleAction(userId: string, newRole: "user" | "admin") {
  const auth = await verifyServerAdmin();
  if (!auth.authorized || !auth.adminId) {
    return { success: false, error: "Unauthorized: Administrator privileges required." };
  }

  // Strictly block self-role modification / privilege escalation
  if (userId === auth.adminId) {
    return { success: false, error: "Forbidden: Administrators cannot modify their own role." };
  }

  const adminId = auth.adminId;
  const adminSupabase = createAdminClient();

  const { error } = await adminSupabase
    .from("profiles")
    .update({ 
      role: newRole,
      is_admin: newRole === "admin",
      is_admin_account: newRole === "admin",
      updated_at: new Date().toISOString()
    })
    .eq("id", userId);

  if (error) return { success: false, error: error.message };

  // Sync app_admins table
  if (newRole === "admin") {
    await adminSupabase
      .from("app_admins")
      .upsert({ user_id: userId, role: "admin", granted_at: new Date().toISOString() }, { onConflict: "user_id" });
  } else {
    await adminSupabase.from("app_admins").delete().eq("user_id", userId);
  }

  // Record Audit Event with verified admin identity
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
  const auth = await verifyServerAdmin();
  if (!auth.authorized || !auth.adminId) {
    return { success: false, error: "Unauthorized: Administrator privileges required." };
  }

  // Block self-suspension
  if (userId === auth.adminId) {
    return { success: false, error: "Forbidden: Administrators cannot suspend their own account." };
  }

  const adminId = auth.adminId;
  const adminSupabase = createAdminClient();
  const newStatus = !currentSuspendedStatus;

  const { error } = await adminSupabase
    .from("profiles")
    .update({ 
      is_suspended: newStatus,
      is_banned: newStatus,
      updated_at: new Date().toISOString()
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
  const auth = await verifyServerAdmin();
  if (!auth.authorized || !auth.adminId) {
    throw new Error("Unauthorized: Administrator privileges required.");
  }

  // Block self-ban
  if (userId === auth.adminId) {
    throw new Error("Forbidden: Administrators cannot ban their own account.");
  }

  const adminId = auth.adminId;
  const adminSupabase = createAdminClient();

  const { error } = await adminSupabase
    .from("profiles")
    .update({
      is_banned: isBanned,
      is_suspended: isBanned,
      updated_at: new Date().toISOString()
    })
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
  const auth = await verifyServerAdmin();
  if (!auth.authorized || !auth.adminId) {
    throw new Error("Unauthorized: Administrator privileges required.");
  }

  const adminId = auth.adminId;
  const adminSupabase = createAdminClient();

  const { error } = await adminSupabase
    .from("profiles")
    .update({
      wallet_balance: newBalance,
      updated_at: new Date().toISOString()
    })
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

