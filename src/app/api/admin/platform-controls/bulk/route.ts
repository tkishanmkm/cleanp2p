import { NextRequest, NextResponse } from "next/server";
import { verifyServerAdmin } from "@/lib/server-admin-auth";
import {
  pauseAllAds,
  resumeAllAds,
  deleteAllAds,
  banAllUsers,
  unbanAllUsers,
  restrictAllUsers,
  unrestrictAllUsers,
} from "@/lib/platform-bulk-actions";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const auth = await verifyServerAdmin(req);
    if (!auth.authorized) {
      return auth.response!;
    }
    if (auth.supportAdmin === true || auth.supportReadOnly === true) {
      return NextResponse.json(
        { success: false, error: "Support administrators cannot run bulk platform controls." },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const { action } = body;

    const adminEmail = auth.adminEmail || "";
    const adminId = auth.adminId || auth.user.id;

    if (!action || typeof action !== "string") {
      return NextResponse.json({ success: false, error: "Missing or invalid bulk action parameter." }, { status: 400 });
    }

    switch (action) {
      case "pause_all_ads": {
        const res = await pauseAllAds(adminId, adminEmail);
        return NextResponse.json({
          success: res.success,
          action,
          affectedCount: res.affectedCount,
          partialFailure: res.partialFailure ?? false,
          failedStage: res.failedStage,
          message: res.success
            ? `Successfully paused ${res.affectedCount} active advertisements.`
            : "Unable to confirm that all advertisements were paused. Check the error and reconcile advertisement states before retrying.",
          error: res.error,
        }, { status: res.success ? 200 : 500 });
      }

      case "resume_all_ads": {
        const res = await resumeAllAds(adminId, adminEmail);
        return NextResponse.json({
          success: res.success,
          action,
          affectedCount: res.affectedCount,
          skippedCount: res.skippedCount,
          partialFailure: res.partialFailure ?? false,
          failedStage: res.failedStage,
          message: res.success
            ? `Successfully resumed ${res.affectedCount} eligible advertisements (${res.skippedCount} remained paused because owner eligibility or inventory rules were not satisfied).`
            : "Unable to confirm that all eligible advertisements were resumed. Check the error and reconcile advertisement states before retrying.",
          error: res.error,
        }, { status: res.success ? 200 : 500 });
      }

      case "delete_all_ads": {
        const res = await deleteAllAds(adminId, adminEmail);
        return NextResponse.json({
          success: res.success,
          action,
          affectedCount: res.affectedCount,
          partialFailure: res.partialFailure ?? false,
          failedStage: res.failedStage,
          message: res.success
            ? `Successfully marked ${res.affectedCount} advertisements as deleted. Existing trades remain unaffected.`
            : "Unable to confirm that all advertisements were soft-deleted. Check the error and reconcile advertisement states before retrying.",
          error: res.error,
        }, { status: res.success ? 200 : 500 });
      }

      case "ban_all_users": {
        const res = await banAllUsers(adminId, adminEmail, body.reason);
        return NextResponse.json({
          success: res.success,
          action,
          affectedCount: res.affectedCount,
          skippedCount: res.skippedCount,
          conflictCount: res.conflictCount,
          runId: res.runId,
          message: res.success
            ? (res.skippedCount !== undefined
              ? `Successfully banned ${res.affectedCount} non-admin users. ${res.skippedCount} pre-existing banned accounts were preserved untouched.`
              : `Successfully banned ${res.affectedCount} non-admin users. Administrators were excluded.`)
            : "Unable to confirm the bulk-ban operation completed. Review the error and reconcile account states before retrying.",
          error: res.error,
        }, { status: res.success ? 200 : 500 });
      }

      case "unban_all_users": {
        const res = await unbanAllUsers(adminId, adminEmail);
        return NextResponse.json({
          success: res.success,
          action,
          affectedCount: res.affectedCount,
          conflictCount: res.conflictCount,
          message: res.success
            ? (res.conflictCount && res.conflictCount > 0
              ? `Successfully restored ${res.affectedCount} users to pre-ban state. ${res.conflictCount} accounts with post-ban manual changes were preserved untouched.`
              : `Successfully restored ${res.affectedCount} users to their exact pre-ban state. Pre-existing manual/fraud bans were preserved untouched.`)
            : "Unable to confirm the bulk-unban operation completed. Review the error and reconcile account states before retrying.",
          error: res.error,
        }, { status: res.success ? 200 : 500 });
      }

      case "restrict_all_users": {
        const res = await restrictAllUsers(adminId, adminEmail, body.reason);
        return NextResponse.json({
          success: res.success,
          action,
          affectedCount: res.affectedCount,
          skippedCount: res.skippedCount,
          conflictCount: res.conflictCount,
          runId: res.runId,
          message: res.success
            ? (res.skippedCount !== undefined
              ? `Successfully restricted ${res.affectedCount} non-admin users. ${res.skippedCount} pre-existing restricted/banned accounts were preserved untouched.`
              : `Successfully restricted ${res.affectedCount} non-admin users. Administrators were excluded.`)
            : "Unable to confirm the bulk-restriction operation completed. Review the error and reconcile account states before retrying.",
          error: res.error,
        }, { status: res.success ? 200 : 500 });
      }

      case "unrestrict_all_users": {
        const res = await unrestrictAllUsers(adminId, adminEmail);
        return NextResponse.json({
          success: res.success,
          action,
          affectedCount: res.affectedCount,
          conflictCount: res.conflictCount,
          message: res.success
            ? (res.conflictCount && res.conflictCount > 0
              ? `Successfully restored ${res.affectedCount} users to pre-restriction state. ${res.conflictCount} accounts with post-restriction manual/ban changes were preserved untouched.`
              : `Successfully restored ${res.affectedCount} users to their exact pre-restriction state. Pre-existing individual suspensions were preserved untouched.`)
            : "Unable to confirm the bulk-unrestriction operation completed. Review the error and reconcile account states before retrying.",
          error: res.error,
        }, { status: res.success ? 200 : 500 });
      }

      default:
        return NextResponse.json({ success: false, error: `Unsupported bulk action: ${action}` }, { status: 400 });
    }
  } catch (err: any) {
    console.error("[POST /api/admin/platform-controls/bulk] Error:", err);
    return NextResponse.json({ success: false, error: err.message || "Internal server error" }, { status: 500 });
  }
}
