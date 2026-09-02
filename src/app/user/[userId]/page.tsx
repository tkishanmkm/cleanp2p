import React from "react";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { UserStatusIndicator } from "@/components/user-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default async function PublicUserProfilePage({
  params,
}: {
  params: { userId: string };
}) {
  const { userId } = params;

  if (!userId) {
    notFound();
  }

  // Fetch stats and profile using the username/user_id
  let profile: any = null;
  const { data: statsData } = await supabase
    .from("user_account_stats")
    .select("*")
    .or(`username.eq.${userId},user_id.eq.${userId}`)
    .maybeSingle();

  if (statsData) {
    profile = statsData;
  } else {
    // Fallback to profiles table
    const { data: profileData } = await supabase
      .from("profiles")
      .select("*")
      .or(`username.eq.${userId},id.eq.${userId}`)
      .maybeSingle();

    if (profileData) {
      profile = {
        username: profileData.username || userId,
        user_id: profileData.id,
        last_active: profileData.last_active,
        member_since: profileData.created_at,
        preferred_currency: profileData.preferred_currency || "USD",
        last_trade_at: profileData.last_trade_at,
        total_trade_volume: profileData.trade_volume || "0.00",
        completed_trades: profileData.completed_trades || 0,
        positive_feedback: profileData.positive_feedback || 0,
        negative_feedback: profileData.negative_feedback || 0,
        avg_payment_time_min: profileData.avg_payment_time || 0.0,
        avg_release_time_min: profileData.avg_release_time || 0.0,
      };
    }
  }

  if (!profile) {
    notFound();
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Header Card displaying ONLY User ID */}
      <Card className="border shadow-sm">
        <CardHeader className="border-b pb-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs text-muted-foreground uppercase font-semibold">
                Trader Profile
              </p>
              <CardTitle className="text-2xl font-mono font-bold text-primary mt-1">
                @{profile.username}
              </CardTitle>
            </div>
            <UserStatusIndicator lastActive={profile.last_active} />
          </div>
        </CardHeader>
        <CardContent className="pt-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <span className="text-xs text-muted-foreground font-medium">
                User ID
              </span>
              <p className="text-sm font-mono font-bold text-foreground">
                @{profile.username}
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground font-medium">
                Member Since
              </span>
              <p className="text-sm font-semibold text-foreground">
                {profile.member_since
                  ? new Date(profile.member_since).toLocaleDateString()
                  : "N/A"}
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground font-medium">
                Preferred Currency
              </span>
              <p className="text-sm font-semibold text-foreground">
                {profile.preferred_currency || "USD"}
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground font-medium">
                Last Trade
              </span>
              <p className="text-sm font-semibold text-foreground">
                {profile.last_trade_at
                  ? new Date(profile.last_trade_at).toLocaleDateString()
                  : "No trades yet"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Account Stats */}
      <Card className="border shadow-sm">
        <CardHeader className="border-b pb-3">
          <CardTitle className="text-lg font-bold">Trade Statistics</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <span className="text-xs text-muted-foreground">Total Volume</span>
            <p className="text-lg font-bold text-foreground">
              ${profile.total_trade_volume || "0.00"}
            </p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Completed Trades</span>
            <p className="text-lg font-bold text-foreground">
              {profile.completed_trades || 0}
            </p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Positive Feedback</span>
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
              {profile.positive_feedback || 0}
            </p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Negative Feedback</span>
            <p className="text-lg font-bold text-rose-600 dark:text-rose-400">
              {profile.negative_feedback || 0}
            </p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Avg. Payment Time</span>
            <p className="text-sm font-semibold text-foreground">
              {profile.avg_payment_time_min || 0.0} min
            </p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Avg. Release Time</span>
            <p className="text-sm font-semibold text-foreground">
              {profile.avg_release_time_min || 0.0} min
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
