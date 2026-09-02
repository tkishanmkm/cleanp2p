"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export async function exportAuditLogsAction(format: "csv" | "json") {
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

  if (!user) return { success: false, error: "Unauthorized" };

  // Verify admin access
  const adminSupabase = createAdminClient();
  const { data: profile } = await adminSupabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "admin") {
    return { success: false, error: "Forbidden: Admin permissions required." };
  }

  // Fetch full log history
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
