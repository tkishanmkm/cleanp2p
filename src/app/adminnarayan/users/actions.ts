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
      status_operation_id: null,
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
      status_operation_id: null,
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

export async function freezeUserAction(targetUserId: string, reason: string) {
  const auth = await verifyServerAdmin();
  if (!auth.authorized || !auth.adminId) {
    return { success: false, error: "Unauthorized: Administrator privileges required." };
  }

  if (targetUserId === auth.adminId) {
    return { success: false, error: "Forbidden: Administrators cannot apply an emergency freeze to their own account." };
  }

  const cleanReason = (reason || "").trim();
  if (!cleanReason) {
    return { success: false, error: "Reason required: An explicit reason must be provided for an emergency freeze." };
  }

  const adminSupabase = createAdminClient();

  // Execute canonical DB RPC admin_freeze_user strictly
  try {
    const { data: rpcData, error: rpcErr } = await adminSupabase.rpc("admin_freeze_user", {
      p_target_user_id: targetUserId,
      p_reason: cleanReason,
    });

    if (rpcErr) {
      return { success: false, error: rpcErr.message };
    }
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to apply emergency freeze." };
  }

  revalidatePath("/adminnarayan/users");
  revalidatePath(`/adminnarayan/users/${targetUserId}`);
  revalidatePath("/adminnarayan/dashboard");
  return { success: true };
}

export async function unfreezeUserAction(targetUserId: string, reason?: string) {
  const auth = await verifyServerAdmin();
  if (!auth.authorized || !auth.adminId) {
    return { success: false, error: "Unauthorized: Administrator privileges required." };
  }

  const cleanReason = (reason || "").trim() || "Admin unfreeze";
  const adminSupabase = createAdminClient();

  // Execute canonical DB RPC admin_unfreeze_user strictly
  try {
    const { data: rpcData, error: rpcErr } = await adminSupabase.rpc("admin_unfreeze_user", {
      p_target_user_id: targetUserId,
      p_reason: cleanReason,
    });

    if (rpcErr) {
      return { success: false, error: rpcErr.message };
    }
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to lift emergency freeze." };
  }

  revalidatePath("/adminnarayan/users");
  revalidatePath(`/adminnarayan/users/${targetUserId}`);
  revalidatePath("/adminnarayan/dashboard");
  return { success: true };
}


