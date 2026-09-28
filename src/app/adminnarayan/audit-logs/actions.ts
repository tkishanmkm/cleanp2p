"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { verifyServerAdmin } from "@/lib/server-admin-auth";

export async function exportAuditLogsAction(format: "csv" | "json") {
  const auth = await verifyServerAdmin();
  if (!auth.authorized || !auth.adminId) {
    return { success: false, error: "Unauthorized: Admin permissions required." };
  }

  // Fetch full log history
  const adminSupabase = createAdminClient();
  const { data: logs, error } = await adminSupabase
    .from("admin_audit_logs")
    .select(`
      id,
      created_at,
      action,
      target_id,
      details,
      admin:profiles!admin_id(full_name)
    `)
    .order("created_at", { ascending: false });

  if (error || !logs) {
    return { success: false, error: error?.message || "Failed to retrieve logs" };
  }

  if (format === "json") {
    const jsonString = JSON.stringify(logs, null, 2);
    return {
      success: true,
      data: jsonString,
      filename: `admin_audit_logs_${new Date().toISOString().split("T")[0]}.json`,
      contentType: "application/json",
    };
  }

  // Generate CSV format
  const headers = ["ID", "Timestamp", "Admin Name", "Action", "Target ID", "Details"];
  const csvRows = logs.map((log) => {
    const adminName = (log.admin as any)?.full_name || "Unknown";
    const detailsStr = JSON.stringify(log.details || {}).replace(/"/g, '""');
    return [
      `"${log.id}"`,
      `"${log.created_at}"`,
      `"${adminName}"`,
      `"${log.action}"`,
      `"${log.target_id || ""}"`,
      `"${detailsStr}"`,
    ].join(",");
  });

  const csvString = [headers.join(","), ...csvRows].join("\n");

  return {
    success: true,
    data: csvString,
    filename: `admin_audit_logs_${new Date().toISOString().split("T")[0]}.csv`,
    contentType: "text/csv",
  };
}
