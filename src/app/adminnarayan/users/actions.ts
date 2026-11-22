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
  if (auth.supportAdmin === true) {
    return { success: false, error: "Support administrators cannot perform this account-administration action." };
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
  if (auth.supportAdmin === true) {
    return { success: false, error: "Support administrators cannot perform this account-administration action." };
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
  if (auth.supportAdmin === true) {
    throw new Error("Support administrators cannot perform this account-administration action.");
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
  if (auth.supportAdmin === true) {
    return { success: false, error: "Support administrators cannot perform this account-administration action." };
  }

  if (targetUserId === auth.adminId) {
    return { success: false, error: "Forbidden: Administrators cannot apply an emergency freeze to their own account." };
  }

  const cleanReason = (reason || "").trim();
  if (cleanReason.length < 3) {
    return { success: false, error: "Reason required: An explicit reason must be provided for an emergency freeze." };
  }

  // The server gate has verified the current administrator and signed 2FA session.
  const adminSupabase = createAdminClient();

  try {
    const { data: rpcData, error: rpcErr } = await adminSupabase.rpc("admin_freeze_user_authorized", {
      p_target_user_id: targetUserId,
      p_reason: cleanReason,
      p_actor_id: auth.adminId,
      p_actor_email: auth.adminEmail ?? null,
    });

    if (rpcErr) {
      return { success: false, error: rpcErr.message };
    }
    if (!rpcData || typeof rpcData !== "object" || rpcData.success !== true) {
      return { success: false, error: "Emergency freeze was not confirmed by the database." };
    }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to apply emergency freeze." };
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
  if (auth.supportAdmin === true) {
    return { success: false, error: "Support administrators cannot perform this account-administration action." };
  }

  const cleanReason = (reason || "").trim() || "Admin unfreeze";
  // The server gate has verified the current administrator and signed 2FA session.
  const adminSupabase = createAdminClient();

  try {
    const { data: rpcData, error: rpcErr } = await adminSupabase.rpc("admin_unfreeze_user_authorized", {
      p_target_user_id: targetUserId,
      p_reason: cleanReason,
      p_actor_id: auth.adminId,
      p_actor_email: auth.adminEmail ?? null,
    });

    if (rpcErr) {
      return { success: false, error: rpcErr.message };
    }
    if (!rpcData || typeof rpcData !== "object" || rpcData.success !== true) {
      return { success: false, error: "Emergency unfreeze was not confirmed by the database." };
    }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : "Failed to lift emergency freeze." };
  }

  revalidatePath("/adminnarayan/users");
  revalidatePath(`/adminnarayan/users/${targetUserId}`);
  revalidatePath("/adminnarayan/dashboard");
  return { success: true };
}


