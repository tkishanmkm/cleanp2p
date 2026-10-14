import { getSupabaseAdminClient } from "@/lib/supabase/server";

export async function pauseAllAds(adminId: string, adminEmail: string): Promise<{
  success: boolean;
  affectedCount: number;
  error?: string;
}> {
  try {
    const supabase = getSupabaseAdminClient();

    // 1. Find all currently active ads in ads and p2p_ads
    const { data: activeAds, error: fetchAdsErr } = await supabase
      .from("ads")
      .select("id")
      .or("status.eq.active,status.eq.published,status.eq.ACTIVE,is_active.eq.true");

    const { data: activeP2pAds, error: fetchP2pErr } = await supabase
      .from("p2p_ads")
      .select("id")
      .or("status.eq.ACTIVE,active.eq.true");

    if (fetchAdsErr && fetchP2pErr) {
      throw fetchAdsErr || fetchP2pErr;
    }

    const adIds = (activeAds || []).map((a: any) => a.id);
    const p2pAdIds = (activeP2pAds || []).map((a: any) => a.id);
    const totalCount = adIds.length + p2pAdIds.length;

    // 2. Mark active ads as GLOBAL_PAUSED
    if (adIds.length > 0) {
      await supabase
        .from("ads")
        .update({
          status: "GLOBAL_PAUSED",
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .in("id", adIds);
    }

    if (p2pAdIds.length > 0) {
      await supabase
        .from("p2p_ads")
        .update({
          status: "GLOBAL_PAUSED",
          active: false,
          updated_at: new Date().toISOString(),
        })
        .in("id", p2pAdIds);
    }

    // Also update advertisements table if any active. Supabase query builders
    // return errors in the result object; they are not Promise.catch() chains.
    const { error: advertisementsPauseError } = await supabase
      .from("advertisements")
      .update({
        status: "GLOBAL_PAUSED",
        is_active: false,
      })
      .eq("is_active", true);

    if (advertisementsPauseError) {
      console.error("[pauseAllAds] Failed to pause advertisements table rows:", advertisementsPauseError);
    }

    // Save timestamp in system_settings
    await supabase
      .from("system_settings")
      .upsert(
        {
          key: "all_ads_paused_at",
          value: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
      );

    // Audit log
    await supabase.from("admin_audit_logs").insert({
      admin_id: adminId,
      admin_email: adminEmail,
      action: "BULK_ADS_PAUSED",
      details: {
        affected_count: totalCount,
        ads_count: adIds.length,
        p2p_ads_count: p2pAdIds.length,
        paused_at: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    });

    return { success: true, affectedCount: totalCount };
  } catch (err: any) {
    console.error("[pauseAllAds] Error:", err);
    return { success: false, affectedCount: 0, error: err.message };
  }
}

export async function resumeAllAds(adminId: string, adminEmail: string): Promise<{
  success: boolean;
  affectedCount: number;
  skippedCount: number;
  error?: string;
}> {
  try {
    const supabase = getSupabaseAdminClient();

    // 1. Query ads that were specifically paused by global pause
    const { data: pausedAds } = await supabase
      .from("ads")
      .select("id, user_id")
      .eq("status", "GLOBAL_PAUSED");

    const { data: pausedP2pAds } = await supabase
      .from("p2p_ads")
      .select("id, user_id")
      .eq("status", "GLOBAL_PAUSED");

    const allPaused = [...(pausedAds || []), ...(pausedP2pAds || [])];

    if (allPaused.length === 0) {
      return { success: true, affectedCount: 0, skippedCount: 0 };
    }

    // 2. Fetch all user IDs that are banned or suspended to exclude them
    const userIds = Array.from(new Set(allPaused.map((a: any) => a.user_id).filter(Boolean)));
    let restrictedUserSet = new Set<string>();

    if (userIds.length > 0) {
      const { data: restrictedProfiles } = await supabase
        .from("profiles")
        .select("id")
        .in("id", userIds)
        .or("is_banned.eq.true,is_suspended.eq.true,status.eq.banned,status.eq.suspended,status.eq.restricted");

      restrictedUserSet = new Set((restrictedProfiles || []).map((p: any) => p.id));
    }

    // Eligible ads are those whose owner is in good standing
    const eligibleAdIds = (pausedAds || [])
      .filter((a: any) => !restrictedUserSet.has(a.user_id))
      .map((a: any) => a.id);

    const eligibleP2pAdIds = (pausedP2pAds || [])
      .filter((a: any) => !restrictedUserSet.has(a.user_id))
      .map((a: any) => a.id);

    const totalEligible = eligibleAdIds.length + eligibleP2pAdIds.length;
    const skippedCount = allPaused.length - totalEligible;

    if (eligibleAdIds.length > 0) {
      await supabase
        .from("ads")
        .update({
          status: "active",
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .in("id", eligibleAdIds);
    }

    if (eligibleP2pAdIds.length > 0) {
      await supabase
        .from("p2p_ads")
        .update({
          status: "ACTIVE",
          active: true,
          updated_at: new Date().toISOString(),
        })
        .in("id", eligibleP2pAdIds);
    }

    // Clear all_ads_paused_at
    await supabase
      .from("system_settings")
      .delete()
      .eq("key", "all_ads_paused_at");

    // Audit log
    await supabase.from("admin_audit_logs").insert({
      admin_id: adminId,
      admin_email: adminEmail,
      action: "BULK_ADS_RESUMED",
      details: {
        affected_count: totalEligible,
        skipped_count: skippedCount,
        resumed_at: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    });

    return {
      success: true,
      affectedCount: totalEligible,
      skippedCount,
    };
  } catch (err: any) {
    console.error("[resumeAllAds] Error:", err);
    return { success: false, affectedCount: 0, skippedCount: 0, error: err.message };
  }
}

export async function deleteAllAds(adminId: string, adminEmail: string): Promise<{
  success: boolean;
  affectedCount: number;
  error?: string;
}> {
  try {
    const supabase = getSupabaseAdminClient();

    // Soft-delete all non-deleted ads in both ads and p2p_ads
    const { data: adsToDelete } = await supabase
      .from("ads")
      .select("id")
      .neq("status", "DELETED");

    const { data: p2pAdsToDelete } = await supabase
      .from("p2p_ads")
      .select("id")
      .neq("status", "DELETED");

    const adIds = (adsToDelete || []).map((a: any) => a.id);
    const p2pAdIds = (p2pAdsToDelete || []).map((a: any) => a.id);
    const totalCount = adIds.length + p2pAdIds.length;

    if (adIds.length > 0) {
      await supabase
        .from("ads")
        .update({
          status: "DELETED",
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .in("id", adIds);
    }

    if (p2pAdIds.length > 0) {
      await supabase
        .from("p2p_ads")
        .update({
          status: "DELETED",
          active: false,
          updated_at: new Date().toISOString(),
        })
        .in("id", p2pAdIds);
    }

    // Audit log
    await supabase.from("admin_audit_logs").insert({
      admin_id: adminId,
      admin_email: adminEmail,
      action: "BULK_ADS_DELETED",
      details: {
        affected_count: totalCount,
        ads_count: adIds.length,
        p2p_ads_count: p2pAdIds.length,
        deleted_at: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    });

    return { success: true, affectedCount: totalCount };
  } catch (err: any) {
    console.error("[deleteAllAds] Error:", err);
    return { success: false, affectedCount: 0, error: err.message };
  }
}

export async function banAllUsers(
  adminId: string,
  adminEmail: string,
  reason?: string
): Promise<{
  success: boolean;
  affectedCount: number;
  skippedCount?: number;
  conflictCount?: number;
  runId?: string;
  error?: string;
}> {
  try {
    const supabase = getSupabaseAdminClient();

    const { data: rpcData, error: rpcErr } = await supabase.rpc("execute_bulk_ban_atomic", {
      p_admin_id: adminId,
      p_admin_email: adminEmail,
      p_reason: reason || "Global administrator administrative ban",
    });

    if (rpcErr) {
      console.error("[banAllUsers] RPC Error:", rpcErr);
      return { success: false, affectedCount: 0, error: rpcErr.message };
    }

    if (!rpcData || !rpcData.success) {
      return {
        success: false,
        affectedCount: 0,
        error: rpcData?.error || "Failed to execute bulk ban operation in database.",
      };
    }

    return {
      success: true,
      affectedCount: rpcData.affected_count || 0,
      skippedCount: rpcData.skipped_count || 0,
      conflictCount: rpcData.conflict_count || 0,
      runId: rpcData.operation_run_id || rpcData.run_id,
    };
  } catch (err: any) {
    console.error("[banAllUsers] Error:", err);
    return { success: false, affectedCount: 0, error: err.message };
  }
}

export async function unbanAllUsers(adminId: string, adminEmail: string): Promise<{
  success: boolean;
  affectedCount: number;
  conflictCount?: number;
  error?: string;
}> {
  try {
    const supabase = getSupabaseAdminClient();

    const { data: rpcData, error: rpcErr } = await supabase.rpc("execute_bulk_unban_atomic", {
      p_admin_id: adminId,
      p_admin_email: adminEmail,
    });

    if (rpcErr) {
      console.error("[unbanAllUsers] RPC Error:", rpcErr);
      return { success: false, affectedCount: 0, error: rpcErr.message };
    }

    if (!rpcData || !rpcData.success) {
      return {
        success: false,
        affectedCount: 0,
        error: rpcData?.error || "Failed to execute bulk unban operation in database.",
      };
    }

    return {
      success: true,
      affectedCount: rpcData.restored_count || 0,
      conflictCount: rpcData.conflict_count || 0,
    };
  } catch (err: any) {
    console.error("[unbanAllUsers] Error:", err);
    return { success: false, affectedCount: 0, error: err.message };
  }
}

export async function restrictAllUsers(
  adminId: string,
  adminEmail: string,
  reason?: string
): Promise<{
  success: boolean;
  affectedCount: number;
  skippedCount?: number;
  conflictCount?: number;
  runId?: string;
  error?: string;
}> {
  try {
    const supabase = getSupabaseAdminClient();

    const { data: rpcData, error: rpcErr } = await supabase.rpc("execute_bulk_restrict_atomic", {
      p_admin_id: adminId,
      p_admin_email: adminEmail,
      p_reason: reason || "Global administrator restriction",
    });

    if (rpcErr) {
      console.error("[restrictAllUsers] RPC Error:", rpcErr);
      return { success: false, affectedCount: 0, error: rpcErr.message };
    }

    if (!rpcData || !rpcData.success) {
      return {
        success: false,
        affectedCount: 0,
        error: rpcData?.error || "Failed to execute bulk restrict operation in database.",
      };
    }

    return {
      success: true,
      affectedCount: rpcData.affected_count || 0,
      skippedCount: rpcData.skipped_count || 0,
      conflictCount: rpcData.conflict_count || 0,
      runId: rpcData.operation_run_id || rpcData.run_id,
    };
  } catch (err: any) {
    console.error("[restrictAllUsers] Error:", err);
    return { success: false, affectedCount: 0, error: err.message };
  }
}

export async function unrestrictAllUsers(adminId: string, adminEmail: string): Promise<{
  success: boolean;
  affectedCount: number;
  conflictCount?: number;
  error?: string;
}> {
  try {
    const supabase = getSupabaseAdminClient();

    const { data: rpcData, error: rpcErr } = await supabase.rpc("execute_bulk_unrestrict_atomic", {
      p_admin_id: adminId,
      p_admin_email: adminEmail,
    });

    if (rpcErr) {
      console.error("[unrestrictAllUsers] RPC Error:", rpcErr);
      return { success: false, affectedCount: 0, error: rpcErr.message };
    }

    if (!rpcData || !rpcData.success) {
      return {
        success: false,
        affectedCount: 0,
        error: rpcData?.error || "Failed to execute bulk unrestrict operation in database.",
      };
    }

    return {
      success: true,
      affectedCount: rpcData.restored_count || 0,
      conflictCount: rpcData.conflict_count || 0,
    };
  } catch (err: any) {
    console.error("[unrestrictAllUsers] Error:", err);
    return { success: false, affectedCount: 0, error: err.message };
  }
}

export async function adminUnblockUserBlock(
  blockId: string,
  blockerId: string,
  blockedId: string,
  adminId: string,
  adminEmail: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = getSupabaseAdminClient();

    // 1. Delete from user_blocks
    if (blockId) {
      await supabase.from("user_blocks").delete().eq("id", blockId);
    } else if (blockerId && blockedId) {
      await supabase
        .from("user_blocks")
        .delete()
        .eq("blocker_id", blockerId)
        .eq("blocked_id", blockedId);
    }

    // 2. Sync profiles.blocked_users array on blocker profile
    if (blockerId) {
      const { data: blockerProfile } = await supabase
        .from("profiles")
        .select("blocked_users")
        .eq("id", blockerId)
        .maybeSingle();

      if (blockerProfile && Array.isArray(blockerProfile.blocked_users)) {
        const updatedBlocked = blockerProfile.blocked_users.filter((id: string) => id !== blockedId);
        await supabase
          .from("profiles")
          .update({
            blocked_users: updatedBlocked,
            updated_at: new Date().toISOString(),
          })
          .eq("id", blockerId);
      }
    }

    // 3. Log audit event
    await supabase.from("admin_audit_logs").insert({
      admin_id: adminId,
      admin_email: adminEmail,
      action: "USER_UNBLOCKED_BY_ADMIN",
      target_id: blockedId,
      details: {
        block_id: blockId,
        blocker_id: blockerId,
        blocked_id: blockedId,
        executed_by: adminEmail,
        timestamp: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    });

    return { success: true };
  } catch (err: any) {
    console.error("[adminUnblockUserBlock] Error:", err);
    return { success: false, error: err.message };
  }
}
