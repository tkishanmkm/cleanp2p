import { ReactNode } from "react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { AdminShell } from "./admin-shell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  let user = null;
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    user = data.user;
  } catch {}

  // Fetch admin profile details & quick counters
  const adminSupabase = createAdminClient();
  let adminName: string | undefined;
  const counts: { disputes?: number; deposits?: number; withdrawals?: number; tickets?: number } = {};

  try {
    const [profileRes, disputesRes, depositsRes, withdrawalsRes, ticketsRes] = await Promise.allSettled([
      user ? adminSupabase.from("profiles").select("full_name").eq("id", user.id).maybeSingle() : Promise.resolve({ data: null }),
      adminSupabase.from("disputes").select("*", { count: "exact", head: true }).eq("status", "open"),
      adminSupabase.from("deposits").select("*", { count: "exact", head: true }).eq("status", "awaiting_confirmation"),
      adminSupabase.from("withdrawals").select("*", { count: "exact", head: true }).eq("status", "pending"),
      adminSupabase.from("support_tickets").select("*", { count: "exact", head: true }).eq("status", "Open"),
    ]);

    if (profileRes.status === "fulfilled" && profileRes.value?.data) {
      adminName = profileRes.value.data.full_name;
    }

    if (disputesRes.status === "fulfilled") counts.disputes = disputesRes.value.count ?? 0;
    if (depositsRes.status === "fulfilled") counts.deposits = depositsRes.value.count ?? 0;
    if (withdrawalsRes.status === "fulfilled") counts.withdrawals = withdrawalsRes.value.count ?? 0;
    if (ticketsRes.status === "fulfilled") counts.tickets = ticketsRes.value.count ?? 0;
  } catch (err) {
    console.error("[ADMIN LAYOUT STATS FETCH ERROR]:", err);
  }

  return (
    <AdminShell adminEmail={user?.email} adminName={adminName} counts={counts}>
      {children}
    </AdminShell>
  );
}
