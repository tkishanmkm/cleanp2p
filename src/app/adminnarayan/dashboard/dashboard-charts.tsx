"use client";

import { useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { TrendingUp, Users } from "lucide-react";

interface DashboardChartsProps {
  volumeData: { date: string; volume: number; trades: number }[];
  userGrowthData: { date: string; users: number }[];
}

export function DashboardCharts({ volumeData, userGrowthData }: DashboardChartsProps) {
  const [timeframe, setTimeframe] = useState<"7d" | "30d" | "all">("30d");

  // Optional timeframe filtering if enough historical data points exist
  const displayedVolumeData =
    timeframe === "7d"
      ? volumeData.slice(-7)
      : timeframe === "30d"
      ? volumeData.slice(-30)
      : volumeData;

  const displayedUserData =
    timeframe === "7d"
      ? userGrowthData.slice(-7)
      : timeframe === "30d"
      ? userGrowthData.slice(-30)
      : userGrowthData;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Trade Volume & Revenue Chart */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-white flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-blue-400" /> Gross Trade Volume ($)
            </CardTitle>
            <CardDescription className="text-slate-400">
              Aggregated transaction volume processed across the platform.
            </CardDescription>
          </div>
          <select
            value={timeframe}
            onChange={(e) => setTimeframe(e.target.value as any)}
            className="bg-slate-950 border border-slate-800 text-xs text-slate-300 rounded-md px-2.5 py-1 focus:outline-none focus:border-blue-500"
          >
            <option value="7d">Last 7 Days</option>
            <option value="30d">Last 30 Days</option>
            <option value="all">All Time</option>
          </select>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="h-64 w-full">
            {displayedVolumeData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No transaction volume recorded yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={displayedVolumeData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.4} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} tickFormatter={(val) => `$${val}`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", color: "#f8fafc", borderRadius: "8px" }}
                    formatter={(value: any) => [`$${Number(value).toFixed(2)}`, "Volume"]}
                  />
                  <Area type="monotone" dataKey="volume" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#volumeGradient)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      {/* User Registration Growth Chart */}
      <Card className="bg-slate-900 border-slate-800">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <div>
            <CardTitle className="text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-emerald-400" /> New User Signups
            </CardTitle>
            <CardDescription className="text-slate-400">
              Daily profile registrations over time.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="h-64 w-full">
            {displayedUserData.length === 0 ? (
              <div className="h-full flex items-center justify-center text-xs text-slate-500">
                No registration history recorded yet.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={displayedUserData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                  <XAxis dataKey="date" stroke="#64748b" fontSize={11} tickLine={false} />
                  <YAxis stroke="#64748b" fontSize={11} tickLine={false} allowDecimals={false} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#0f172a", borderColor: "#334155", color: "#f8fafc", borderRadius: "8px" }}
                    formatter={(value: any) => [value, "Signups"]}
                  />
                  <Bar dataKey="users" fill="#10b981" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
