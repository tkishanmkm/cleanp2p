import { createAdminClient } from "@/lib/supabase/admin";

interface LogAdminActionParams {
  adminId: string;
  action: string;
  targetId?: string;
  details?: Record<string, any>;
}

export async function logAdminAction({
  adminId,
  action,
  targetId,
  details = {},
}: LogAdminActionParams) {
  const adminSupabase = createAdminClient();

  const { error } = await adminSupabase.from("admin_audit_logs").insert({
    admin_id: adminId,
    action,
    target_id: targetId,
    details,
  });

  if (error) {
    console.error("Failed to insert audit log:", error.message);
  }
}
