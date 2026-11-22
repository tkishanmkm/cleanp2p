import { getSupabaseAdminClient } from "@/lib/supabase/server";

type AtomicBulkAdAction = 'PAUSE' | 'RESUME' | 'DELETE';

type AtomicBulkAdResult = {
  success: boolean;
  affectedCount: number;
  skippedCount: number;
  partialFailure: boolean;
  failedStage?: string;
  error?: string;
};

function readAtomicCount(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * All bulk advertisement changes, their global-pause marker and audit record
 * are committed by one trusted database transaction. A failure rolls the full
 * operation back; the application never performs split-table fallback writes.
 */
async function runAtomicBulkAdAction(
  adminId: string,
  adminEmail: string,
  action: AtomicBulkAdAction
): Promise<AtomicBulkAdResult> {
  try {
    if (!adminId || !adminEmail.trim()) {
      return {
        success: false,
        affectedCount: 0,
        skippedCount: 0,
        partialFailure: false,
        failedStage: 'validate_admin_identity',
        error: 'A verified administrator identity is required for bulk advertisement controls.',
      };
    }

    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase.rpc('admin_bulk_ads_action_atomic', {
      p_admin_id: adminId,
      p_admin_email: adminEmail,
      p_action: action,
    });

    if (error) {
      console.error('[runAtomicBulkAdAction] Database transaction rejected:', {
        action,
        code: error.code || 'unknown',
      });
      return {
        success: false,
        affectedCount: 0,
        skippedCount: 0,
        partialFailure: false,
        failedStage: 'atomic_database_transaction',
        error: error.message || 'The atomic advertisement operation could not be confirmed. Reconcile the current ad states before retrying.',
      };
    }

    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return {
        success: false,
        affectedCount: 0,
        skippedCount: 0,
        partialFailure: false,
        failedStage: 'validate_atomic_response',
        error: 'The database returned an invalid bulk advertisement operation response.',
      };
    }

    const result = data as Record<string, unknown>;
    const affectedCount = readAtomicCount(result.affected_count);
    const skippedCount = readAtomicCount(result.skipped_count ?? 0);
    if (
      result.success !== true ||
      result.action !== action ||
      affectedCount === null ||
      skippedCount === null
    ) {
      return {
        success: false,
        affectedCount: 0,
        skippedCount: 0,
        partialFailure: false,
        failedStage: 'validate_atomic_response',
        error: 'The database returned an incomplete or mismatched bulk advertisement operation result.',
      };
    }

    return {
      success: true,
      affectedCount,
      skippedCount,
      partialFailure: false,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[runAtomicBulkAdAction] Error:', message);
    return {
      success: false,
      affectedCount: 0,
      skippedCount: 0,
      partialFailure: false,
      failedStage: 'atomic_database_transaction',
      error: message,
    };
  }
}

export async function pauseAllAds(adminId: string, adminEmail: string): Promise<{
  success: boolean;
  affectedCount: number;
  partialFailure?: boolean;
  failedStage?: string;
  error?: string;
}> {
  const result = await runAtomicBulkAdAction(adminId, adminEmail, 'PAUSE');
  return result;
}

export async function resumeAllAds(adminId: string, adminEmail: string): Promise<{
  success: boolean;
  affectedCount: number;
  skippedCount: number;
  partialFailure?: boolean;
  failedStage?: string;
  error?: string;
}> {
  const result = await runAtomicBulkAdAction(adminId, adminEmail, 'RESUME');
  return result;
}

export async function deleteAllAds(adminId: string, adminEmail: string): Promise<{
  success: boolean;
  affectedCount: number;
  partialFailure?: boolean;
  failedStage?: string;
  error?: string;
}> {
  const result = await runAtomicBulkAdAction(adminId, adminEmail, 'DELETE');
  return result;
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
