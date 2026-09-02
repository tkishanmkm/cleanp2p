export const dynamic = "force-dynamic";

import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { 
  Users, 
  DollarSign, 
  ShieldAlert, 
  TrendingUp, 
  Activity,
  UserCheck
} from "lucide-react";
import Link from "next/link";
import { DashboardCharts } from "./dashboard-charts";

export default async function AdminDashboardPage() {
  const adminSupabase = createAdminClient();

  // Parallel data fetching
  const [
    { count: totalUsers },
    { count: suspendedUsers },
    { data: tradeData },
    { data: rawTrades },
    { data: rawProfiles },
    { data: recentUsers }
  ] = await Promise.all([
    adminSupabase.from("profiles").select("*", { count: "exact", head: true }),
    adminSupabase.from("profiles").select("*", { count: "exact", head: true }).eq("is_suspended", true),
    adminSupabase.from("trades").select("amount, status"),
    adminSupabase.from("trades").select("amount, created_at").order("created_at", { ascending: true }),
    adminSupabase.from("profiles").select("created_at").order("created_at", { ascending: true }),
    adminSupabase.from("profiles").select("id, full_name, role, created_at").order("created_at", { ascending: false }).limit(5)
  ]);

  // Aggregate metric KPIs
  const totalVolume = tradeData?.reduce((acc, t) => acc + (Number(t.amount) || 0), 0) || 0;
  const lockedEscrow = tradeData
    ?.filter(t => t.status === "escrow_locked" || t.status === "pending")
    .reduce((acc, t) => acc + (Number(t.amount) || 0), 0) || 0;
  const activeTradesCount = tradeData?.filter(t => t.status === "escrow_locked" || t.status === "pending").length || 0;
  const openDisputesCount = tradeData?.filter(t => t.status === "disputed").length || 0;

  // Process time-series data for Trade Volume Chart
  const volumeByDate: Record<string, { volume: number; trades: number }> = {};
  rawTrades?.forEach((t) => {
    const dateStr = new Date(t.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    if (!volumeByDate[dateStr]) {
      volumeByDate[dateStr] = { volume: 0, trades: 0 };
    }
    volumeByDate[dateStr].volume += Number(t.amount) || 0;
    volumeByDate[dateStr].trades += 1;
  });
  const volumeChartData = Object.entries(volumeByDate).map(([date, val]) => ({
    date,
    volume: val.volume,
    trades: val.trades,
  }));

  // Process time-series data for User Registration Growth Chart
  const usersByDate: Record<string, number> = {};
  rawProfiles?.forEach((p) => {
    const dateStr = new Date(p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
    usersByDate[dateStr] = (usersByDate[dateStr] || 0) + 1;
  });
  const userGrowthChartData = Object.entries(usersByDate).map(([date, users]) => ({
    date,
    users,
  }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-2">
          <Activity className="w-8 h-8 text-blue-500" />
          System Overview & Real-Time Analytics
        </h1>
        <p className="text-slate-400">
          Platform-wide health metrics, escrow balances, user growth, and active disputes.
        </p>
      </div>

      {/* Metric Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Total Registered Users</CardTitle>
            <Users className="w-4 h-4 text-emerald-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{totalUsers || 0}</div>
            <p className="text-xs text-slate-500 mt-1">
              <span className="text-red-400">{suspendedUsers || 0}</span> accounts suspended
            </p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Gross Trade Volume</CardTitle>
            <DollarSign className="w-4 h-4 text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">${totalVolume.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
            <p className="text-xs text-slate-500 mt-1">Across {tradeData?.length || 0} total trades</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Capital in Escrow</CardTitle>
            <TrendingUp className="w-4 h-4 text-purple-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">${lockedEscrow.toLocaleString("en-US", { minimumFractionDigits: 2 })}</div>
            <p className="text-xs text-slate-500 mt-1">{activeTradesCount} active trade{activeTradesCount === 1 ? "" : "s"}</p>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-slate-400">Action Required</CardTitle>
            <ShieldAlert className="w-4 h-4 text-amber-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-white">{openDisputesCount}</div>
            <p className="text-xs text-slate-500 mt-1">Open disputes awaiting intervention</p>
          </CardContent>
        </Card>
      </div>

      {/* Visual Analytics Charts */}
      <DashboardCharts volumeData={volumeChartData} userGrowthData={userGrowthChartData} />

      {/* Recent Registrations & Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 bg-slate-900 border-slate-800">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="text-white flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-emerald-400" /> Recent User Registrations
              </CardTitle>
              <CardDescription className="text-slate-400">Latest profiles created across the platform.</CardDescription>
            </div>
            <Link href="/adminnarayan/users" className="text-xs font-semibold text-blue-400 hover:text-blue-300 transition-colors">
              View All Users →
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentUsers?.map((u) => (
                <div key={u.id} className="flex items-center justify-between p-3 bg-slate-950 rounded-lg border border-slate-800/80">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-white">{u.full_name || "Unnamed User"}</p>
                    <p className="text-xs font-mono text-slate-500">{u.id}</p>
                  </div>
                  <div className="text-right">
                    <span className="px-2 py-0.5 text-xs font-semibold rounded-full bg-slate-800 text-slate-300">
                      {u.role || "user"}
                    </span>
                    <p className="text-[10px] text-slate-500 mt-1">{new Date(u.created_at).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-slate-900 border-slate-800">
          <CardHeader>
            <CardTitle className="text-white">Admin Quick Actions</CardTitle>
            <CardDescription className="text-slate-400">Fast path to critical system tasks.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link href="/adminnarayan/trades" className="block p-3 rounded-lg bg-purple-950/30 border border-purple-800/50 hover:bg-purple-900/40 transition-colors">
              <p className="text-sm font-semibold text-purple-200">Resolve Disputes & Escrow</p>
              <p className="text-xs text-purple-400/80">Manage locked funds or perform manual refunds</p>
            </Link>
            <Link href="/adminnarayan/settings" className="block p-3 rounded-lg bg-amber-950/30 border border-amber-800/50 hover:bg-amber-900/40 transition-colors">
              <p className="text-sm font-semibold text-amber-200">Toggle Maintenance Mode</p>
              <p className="text-xs text-amber-400/80">Lock application or update global fees</p>
            </Link>
            <Link href="/adminnarayan/users" className="block p-3 rounded-lg bg-emerald-950/30 border border-emerald-800/50 hover:bg-emerald-900/40 transition-colors">
              <p className="text-sm font-semibold text-emerald-200">Manage Suspensions</p>
              <p className="text-xs text-emerald-400/80">Reactivate or block user accounts</p>
            </Link>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
