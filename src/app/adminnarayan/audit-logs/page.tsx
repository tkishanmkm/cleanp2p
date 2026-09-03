import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ClipboardList, User } from "lucide-react";
import { ExportLogsButton } from "./ExportLogsButton";
import { AuditLogFilters } from "./AuditLogFilters";
import { formatUtcDateTime } from "@/lib/date-utils";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{
    search?: string;
    action?: string;
    startDate?: string;
    endDate?: string;
  }>;
}

export default async function AdminAuditLogsPage({ searchParams }: PageProps) {
  const { search, action, startDate, endDate } = await searchParams;
  const adminSupabase = createAdminClient();

  let query = adminSupabase
    .from("admin_audit_logs")
    .select(`
      *,
      admin:profiles!admin_id(full_name, user_id)
    `)
    .order("created_at", { ascending: false })
    .limit(100);

  // Filter by action type
  if (action && action !== "ALL") {
    query = query.eq("action", action);
  }

  // Filter by start date
  if (startDate) {
    query = query.gte("created_at", new Date(startDate).toISOString());
  }

  // Filter by end date
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    query = query.lte("created_at", end.toISOString());
  }

  // Filter by search string (Target ID or Action match)
  if (search) {
    query = query.or(`action.ilike.%${search}%,target_id.ilike.%${search}%`);
  }

  const { data: logs, error } = await query;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
            <ClipboardList className="w-8 h-8 text-indigo-400" />
            Administrative Audit Logs
          </h1>
          <p className="text-slate-400">
            Immutable history of sensitive admin actions, escrow interventions, and configuration changes.
          </p>
        </div>
        <ExportLogsButton />
      </div>

      {/* Filter Controls Component */}
      <AuditLogFilters />

      <Card className="bg-slate-900 border-slate-800">
        <CardHeader>
          <CardTitle className="text-white">System Events ({logs?.length || 0})</CardTitle>
          <CardDescription className="text-slate-400">
            {search || action || startDate || endDate
              ? "Filtered view of administrative events"
              : "Showing the latest 100 logged events"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {error ? (
            <p className="text-sm text-red-400">Failed to load audit logs: {error.message}</p>
          ) : !logs || logs.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">No administrative actions matching your criteria.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm text-slate-300">
                <thead className="border-b border-slate-800 text-slate-400 uppercase text-xs">
                  <tr>
                    <th className="pb-3 px-2">Timestamp (UTC)</th>
                    <th className="pb-3 px-2">Admin User</th>
                    <th className="pb-3 px-2">Action</th>
                    <th className="pb-3 px-2">Target ID</th>
                    <th className="pb-3 px-2">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/30">
                      <td className="py-3 px-2 text-xs text-slate-400 whitespace-nowrap">
                        {formatUtcDateTime(log.created_at)}
                      </td>
                      <td className="py-3 px-2">
                        <div className="flex items-center gap-1.5 text-xs text-white">
                          <User className="w-3.5 h-3.5 text-indigo-400" />
                          <span>{log.admin?.full_name || "Unknown Admin"}</span>
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-semibold rounded bg-indigo-950 text-indigo-300 border border-indigo-800 font-mono">
                          {log.action}
                        </span>
                      </td>
                      <td className="py-3 px-2 font-mono text-xs text-slate-400">
                        {log.target_id ? log.target_id.slice(0, 12) : "N/A"}
                      </td>
                      <td className="py-3 px-2 text-xs font-mono text-slate-400 max-w-xs truncate">
                        {JSON.stringify(log.details)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
