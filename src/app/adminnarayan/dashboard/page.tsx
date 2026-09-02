import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, ArrowLeftRight, ShieldAlert, ArrowDownToLine } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminDashboardPage() {
  const supabase = await createClient();

  // 1. Retrieve session from cookie
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    console.error("[DASHBOARD AUTH ERROR]:", authError?.message || "No authenticated session found.");
    redirect("/adminnarayan/login");
  }

  // 2. Fetch admin role matching auth ID or custom user_id ('adam_dam')
  const adminSupabase = createAdminClient();
  const { data: profile, error: profileError } = await adminSupabase
    .from("profiles")
    .select("role, full_name")
    .or(`id.eq.${user.id},user_id.eq.adam_dam,user_id.eq.${user.id}`)
    .maybeSingle();

  if (profileError) {
    console.error("[DASHBOARD PROFILE ERROR]:", profileError.message);
  }

  if (!profile || profile.role !== "admin") {
    console.error(`[DASHBOARD ACCESS DENIED] Email: ${user.email}, Role Found: '${profile?.role || "none"}'`);
    redirect("/adminnarayan/login");
  }

  // 3. Fetch live metrics
  let usersCount = 0;
  let activeTradesCount = 0;
  let openDisputesCount = 0;
  let pendingDepositsCount = 0;

  try {
    const [usersRes, tradesRes, disputesRes, depositsRes] = await Promise.all([
      adminSupabase.from("profiles").select("*", { count: "exact", head: true }),
      adminSupabase.from("trades").select("*", { count: "exact", head: true }).in("status", ["active", "paid"]),
      adminSupabase.from("disputes").select("*", { count: "exact", head: true }).eq("status", "open"),
      adminSupabase.from("deposits").select("*", { count: "exact", head: true }).eq("status", "awaiting_confirmation"),
    ]);

    usersCount = usersRes.count ?? 0;
    activeTradesCount = tradesRes.count ?? 0;
    openDisputesCount = disputesRes.count ?? 0;
    pendingDepositsCount = depositsRes.count ?? 0;
  } catch (err) {
    console.error("[DASHBOARD METRICS ERROR]:", err);
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Admin Overview</h1>
        <p className="text-muted-foreground">
          Welcome back, {profile.full_name || user.email}. System live metrics are displayed below.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Registered Users</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{usersCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Trades</CardTitle>
            <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{activeTradesCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open Disputes</CardTitle>
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-amber-600">{openDisputesCount}</div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending Deposits</CardTitle>
            <ArrowDownToLine className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingDepositsCount}</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
