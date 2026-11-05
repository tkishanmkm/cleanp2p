import { getSupabaseAdminClient } from "@/lib/supabase/server";

export async function pauseAllAds(adminId: string, adminEmail: string): Promise<{
  success: boolean;
  affectedCount: number;
  partialFailure?: boolean;
  failedStage?: string;
  error?: string;
}> {
  let confirmedAds = 0;
  let confirmedP2pAds = 0;
  let failedStage = "inspect_ads";
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

    // Do not report a global pause as successful if either primary ad source
    // could not be inspected; otherwise ads from the failed source may remain live.
    if (fetchAdsErr || fetchP2pErr) {
      throw new Error(
        "Unable to inspect all advertisement sources (ads: " +
          (fetchAdsErr?.code || "ok") + ", p2p_ads: " + (fetchP2pErr?.code || "ok") + ")."
      );
    }

    const adIds = (activeAds || []).map((a: any) => a.id);
    const p2pAdIds = (activeP2pAds || []).map((a: any) => a.id);
    const totalCount = adIds.length + p2pAdIds.length;

    // 2. Mark active ads as GLOBAL_PAUSED
    failedStage = "pause_ads";
    if (adIds.length > 0) {
      const { data: updatedAds, error: updateAdsErr } = await supabase
        .from("ads")
        .update({
          status: "GLOBAL_PAUSED",
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .in("id", adIds)
        .select("id");
      if (updateAdsErr) {
        throw new Error("Failed to pause ads table (code: " + (updateAdsErr.code || "unknown") + "). Verify current ad states before retrying.");
      }
      confirmedAds = updatedAds?.length ?? 0;
      if (confirmedAds !== adIds.length) throw new Error("The ads update affected fewer rows than inspected; reconcile current states before retrying.");
    }

    failedStage = "pause_p2p_ads";
    if (p2pAdIds.length > 0) {
      const { data: updatedP2pAds, error: updateP2pAdsErr } = await supabase
        .from("p2p_ads")
        .update({
          status: "GLOBAL_PAUSED",
          active: false,
          updated_at: new Date().toISOString(),
        })
        .in("id", p2pAdIds)
        .select("id");
      if (updateP2pAdsErr) {
        throw new Error("Failed to pause p2p_ads table (code: " + (updateP2pAdsErr.code || "unknown") + ").");
      }
      confirmedP2pAds = updatedP2pAds?.length ?? 0;
      if (confirmedP2pAds !== p2pAdIds.length) throw new Error("The P2P ads update affected fewer rows than inspected; reconcile current states before retrying.");
    }

    // Also update the legacy advertisements table when it exists.
    failedStage = "update_legacy_ads";
    const { error: legacyAdsUpdateError } = await supabase
      .from("advertisements")
      .update({
        status: "GLOBAL_PAUSED",
        is_active: false,
      })
      .eq("is_active", true);

    // The legacy mirror is optional only when the table is absent. If it exists
    // but cannot be updated, fail closed rather than claiming a global pause while
    // legacy advertisements may remain active.
    if (legacyAdsUpdateError && !["42P01", "PGRST205"].includes(legacyAdsUpdateError.code || "")) {
      throw new Error("Primary ads were paused, but the legacy advertisements mirror failed (code: " + (legacyAdsUpdateError.code || "unknown") + "). Reconcile every advertisement source before retrying.");
    }

    // Save timestamp in system_settings
    failedStage = "save_pause_setting";
    const { error: settingsError } = await supabase
      .from("system_settings")
      .upsert(
        {
          key: "all_ads_paused_at",
          value: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "key" }
      );
    if (settingsError) {
      throw new Error("Advertisements were updated but the global-pause setting failed (code: " + (settingsError.code || "unknown") + "). Reconcile before retrying.");
    }

    // Audit log
    failedStage = "write_pause_audit";
    const { error: auditError } = await supabase.from("admin_audit_logs").insert({
      admin_id: adminId,
      admin_email: adminEmail,
      action: "BULK_ADS_PAUSED",
      details: {
        affected_count: confirmedAds + confirmedP2pAds,
        ads_count: confirmedAds,
        p2p_ads_count: confirmedP2pAds,
        paused_at: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    });
    if (auditError) {
      throw new Error("Advertisements were updated but the audit log failed (code: " + (auditError.code || "unknown") + "). Reconcile before retrying.");
    }

    return { success: true, affectedCount: confirmedAds + confirmedP2pAds };
  } catch (err: any) {
    console.error("[pauseAllAds] Error:", err);
    const affectedCount = confirmedAds + confirmedP2pAds;
    return {
      success: false,
      affectedCount,
      partialFailure: affectedCount > 0,
      failedStage,
      error: (affectedCount > 0 ? "Partial operation: " + affectedCount + " ads were confirmed updated. " : "") + (err.message || "Unknown error"),
    };
  }
}

export async function resumeAllAds(adminId: string, adminEmail: string): Promise<{
  success: boolean;
  affectedCount: number;
  skippedCount: number;
  partialFailure?: boolean;
  failedStage?: string;
  error?: string;
}> {
  let confirmedAds = 0;
  let confirmedP2pAds = 0;
  let skippedCount = 0;
  let failedStage = "inspect_paused_ads";
  try {
    const supabase = getSupabaseAdminClient();

    // 1. Query ads that were specifically paused by global pause
    const { data: pausedAds, error: pausedAdsError } = await supabase
      .from("ads")
      .select("id, user_id")
      .eq("status", "GLOBAL_PAUSED");
    if (pausedAdsError) throw new Error("Unable to inspect paused ads (code: " + (pausedAdsError.code || "unknown") + ").");

    const { data: pausedP2pAds, error: pausedP2pAdsError } = await supabase
      .from("p2p_ads")
      .select("id, user_id")
      .eq("status", "GLOBAL_PAUSED");
    if (pausedP2pAdsError) throw new Error("Unable to inspect paused P2P ads (code: " + (pausedP2pAdsError.code || "unknown") + ").");

    const allPaused = [...(pausedAds || []), ...(pausedP2pAds || [])];

    if (allPaused.length === 0) {
      return { success: true, affectedCount: 0, skippedCount: 0 };
    }

    // 2. Fetch all user IDs that are banned or suspended to exclude them
    const userIds = Array.from(new Set(allPaused.map((a: any) => a.user_id).filter(Boolean)));
    let restrictedUserSet = new Set<string>();

    if (userIds.length > 0) {
      const { data: restrictedProfiles, error: restrictedProfilesError } = await supabase
        .from("profiles")
        .select("id")
        .in("id", userIds)
        .or("is_banned.eq.true,is_suspended.eq.true,status.eq.banned,status.eq.suspended,status.eq.restricted");
      if (restrictedProfilesError) {
        failedStage = "verify_ad_owners";
        throw new Error("Unable to verify ad owners are unrestricted (code: " + (restrictedProfilesError.code || "unknown") + "). No ads were resumed.");
      }

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
    skippedCount = allPaused.length - totalEligible;

    failedStage = "resume_ads";
    if (eligibleAdIds.length > 0) {
      const { data: resumedAds, error: resumeAdsError } = await supabase
        .from("ads")
        .update({
          status: "active",
          is_active: true,
          updated_at: new Date().toISOString(),
        })
        .in("id", eligibleAdIds)
        .select("id");
      if (resumeAdsError) throw new Error("Failed to resume ads (code: " + (resumeAdsError.code || "unknown") + "). Reconcile current states before retrying.");
      confirmedAds = resumedAds?.length ?? 0;
      if (confirmedAds !== eligibleAdIds.length) throw new Error("The ads resume update affected fewer rows than inspected; reconcile current states before retrying.");
    }

    failedStage = "resume_p2p_ads";
    if (eligibleP2pAdIds.length > 0) {
      const { data: resumedP2pAds, error: resumeP2pAdsError } = await supabase
        .from("p2p_ads")
        .update({
          status: "ACTIVE",
          active: true,
          updated_at: new Date().toISOString(),
        })
        .in("id", eligibleP2pAdIds)
        .select("id");
      if (resumeP2pAdsError) throw new Error("Failed to resume P2P ads (code: " + (resumeP2pAdsError.code || "unknown") + "). Reconcile current states before retrying.");
      confirmedP2pAds = resumedP2pAds?.length ?? 0;
      if (confirmedP2pAds !== eligibleP2pAdIds.length) throw new Error("The P2P ads resume update affected fewer rows than inspected; reconcile current states before retrying.");
    }

    // Clear all_ads_paused_at
    failedStage = "clear_pause_setting";
    const { error: clearPauseSettingError } = await supabase
      .from("system_settings")
      .delete()
      .eq("key", "all_ads_paused_at");
    if (clearPauseSettingError) throw new Error("Ads may have resumed, but the global-pause setting could not be cleared (code: " + (clearPauseSettingError.code || "unknown") + "). Reconcile before retrying.");

    // Audit log
    failedStage = "write_resume_audit";
    const { error: resumeAuditError } = await supabase.from("admin_audit_logs").insert({
      admin_id: adminId,
      admin_email: adminEmail,
      action: "BULK_ADS_RESUMED",
      details: {
        affected_count: confirmedAds + confirmedP2pAds,
        skipped_count: skippedCount,
        resumed_at: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    });
    if (resumeAuditError) throw new Error("Ads may have resumed, but the audit log failed (code: " + (resumeAuditError.code || "unknown") + "). Reconcile before retrying.");

    return {
      success: true,
      affectedCount: confirmedAds + confirmedP2pAds,
      skippedCount,
    };
  } catch (err: any) {
    console.error("[resumeAllAds] Error:", err);
    const affectedCount = confirmedAds + confirmedP2pAds;
    return {
      success: false,
      affectedCount,
      skippedCount,
      partialFailure: affectedCount > 0,
      failedStage,
      error: (affectedCount > 0 ? "Partial operation: " + affectedCount + " ads were confirmed updated. " : "") + (err.message || "Unknown error"),
    };
  }
}

export async function deleteAllAds(adminId: string, adminEmail: string): Promise<{
  success: boolean;
  affectedCount: number;
  partialFailure?: boolean;
  failedStage?: string;
  error?: string;
}> {
  let confirmedAds = 0;
  let confirmedP2pAds = 0;
  let failedStage = "inspect_ads_for_deletion";
  try {
    const supabase = getSupabaseAdminClient();

    // Soft-delete all non-deleted ads in both ads and p2p_ads
    const { data: adsToDelete, error: adsToDeleteError } = await supabase
      .from("ads")
      .select("id")
      .neq("status", "DELETED");
    if (adsToDeleteError) throw new Error("Unable to inspect ads before deletion (code: " + (adsToDeleteError.code || "unknown") + ").");

    const { data: p2pAdsToDelete, error: p2pAdsToDeleteError } = await supabase
      .from("p2p_ads")
      .select("id")
      .neq("status", "DELETED");
    if (p2pAdsToDeleteError) throw new Error("Unable to inspect P2P ads before deletion (code: " + (p2pAdsToDeleteError.code || "unknown") + ").");

    const adIds = (adsToDelete || []).map((a: any) => a.id);
    const p2pAdIds = (p2pAdsToDelete || []).map((a: any) => a.id);
    const totalCount = adIds.length + p2pAdIds.length;

    failedStage = "delete_ads";
    if (adIds.length > 0) {
      const { data: deletedAds, error: deleteAdsError } = await supabase
        .from("ads")
        .update({
          status: "DELETED",
          is_active: false,
          updated_at: new Date().toISOString(),
        })
        .in("id", adIds)
        .select("id");
      if (deleteAdsError) throw new Error("Failed to soft-delete ads (code: " + (deleteAdsError.code || "unknown") + "). Reconcile current states before retrying.");
      confirmedAds = deletedAds?.length ?? 0;
      if (confirmedAds !== adIds.length) throw new Error("The ads delete update affected fewer rows than inspected; reconcile current states before retrying.");
    }

    failedStage = "delete_p2p_ads";
    if (p2pAdIds.length > 0) {
      const { data: deletedP2pAds, error: deleteP2pAdsError } = await supabase
        .from("p2p_ads")
        .update({
          status: "DELETED",
          active: false,
          updated_at: new Date().toISOString(),
        })
        .in("id", p2pAdIds)
        .select("id");
      if (deleteP2pAdsError) throw new Error("Failed to soft-delete P2P ads (code: " + (deleteP2pAdsError.code || "unknown") + "). Reconcile current states before retrying.");
      confirmedP2pAds = deletedP2pAds?.length ?? 0;
      if (confirmedP2pAds !== p2pAdIds.length) throw new Error("The P2P ads delete update affected fewer rows than inspected; reconcile current states before retrying.");
    }

    // Audit log
    failedStage = "write_delete_audit";
    const { error: deleteAuditError } = await supabase.from("admin_audit_logs").insert({
      admin_id: adminId,
      admin_email: adminEmail,
      action: "BULK_ADS_DELETED",
      details: {
        affected_count: confirmedAds + confirmedP2pAds,
        ads_count: confirmedAds,
        p2p_ads_count: confirmedP2pAds,
        deleted_at: new Date().toISOString(),
      },
      created_at: new Date().toISOString(),
    });
    if (deleteAuditError) throw new Error("Ads may have been soft-deleted, but the audit log failed (code: " + (deleteAuditError.code || "unknown") + "). Reconcile before retrying.");

    return { success: true, affectedCount: confirmedAds + confirmedP2pAds };
  } catch (err: any) {
    console.error("[deleteAllAds] Error:", err);
    const affectedCount = confirmedAds + confirmedP2pAds;
    return {
      success: false,
      affectedCount,
      partialFailure: affectedCount > 0,
      failedStage,
      error: (affectedCount > 0 ? "Partial operation: " + affectedCount + " ads were confirmed updated. " : "") + (err.message || "Unknown error"),
    };
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

    // Require a concrete block target so an accidental empty request cannot report success.
    if (!blockId && (!blockerId || !blockedId)) {
      return { success: false, error: "A block ID or both blocker and blocked user IDs are required." };
    }

    // 1. Delete from user_blocks. This is not transactional with the profile mirror;
    // any later failure is surfaced for reconciliation rather than reported as success.
    const { error: blockDeleteError } = blockId
      ? await supabase.from("user_blocks").delete().eq("id", blockId)
      : await supabase.from("user_blocks").delete().eq("blocker_id", blockerId).eq("blocked_id", blockedId);
    if (blockDeleteError) {
      throw new Error("Failed to delete the user block (code: " + (blockDeleteError.code || "unknown") + ").");
    }

    // 2. Sync profiles.blocked_users array on blocker profile
    if (blockerId) {
      const { data: blockerProfile, error: blockerProfileError } = await supabase
        .from("profiles")
        .select("blocked_users")
        .eq("id", blockerId)
        .maybeSingle();
      if (blockerProfileError) {
        throw new Error("The block row was deleted, but the blocker profile could not be read (code: " + (blockerProfileError.code || "unknown") + "). Reconcile the profile block list.");
      }

      if (blockerProfile && Array.isArray(blockerProfile.blocked_users)) {
        const updatedBlocked = blockerProfile.blocked_users.filter((id: string) => id !== blockedId);
        const { error: blockerProfileUpdateError } = await supabase
          .from("profiles")
          .update({
            blocked_users: updatedBlocked,
            updated_at: new Date().toISOString(),
          })
          .eq("id", blockerId);
        if (blockerProfileUpdateError) {
          throw new Error("The block row was deleted, but the blocker profile list could not be synchronized (code: " + (blockerProfileUpdateError.code || "unknown") + "). Reconcile before retrying.");
        }
      }
    }

    // 3. Log audit event
    const { error: unblockAuditError } = await supabase.from("admin_audit_logs").insert({
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
    if (unblockAuditError) {
      throw new Error("The unblock changes may be applied, but the audit record failed (code: " + (unblockAuditError.code || "unknown") + "). Reconcile and record the event before retrying.");
    }

    return { success: true };
  } catch (err: any) {
    console.error("[adminUnblockUserBlock] Error:", err);
    return { success: false, error: err.message };
  }
}
