"use client";

import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { UserStatusIndicator } from "@/components/user-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/components/providers/auth-provider";
import { useRouter } from "next/navigation";

export default function PrivateProfilePage() {
  const { user: authUser, profile: contextProfile, isUserLoading: isAuthLoading } = useAuth();
  const router = useRouter();
  const [profileData, setProfileData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadCurrentProfile() {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      const targetUser = user || authUser;

      if (!targetUser) {
        if (!isAuthLoading) {
          setLoading(false);
        }
        return;
      }

      try {
        let { data, error } = await supabase
          .from("user_account_stats")
          .select("*")
          .eq("user_id", targetUser.id || targetUser.uid)
          .maybeSingle();

        if (error || !data) {
          const { data: profData } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", targetUser.id || targetUser.uid)
            .maybeSingle();

          if (profData) {
            data = {
              user_id: profData.id,
              username: profData.username || contextProfile?.username || targetUser.email?.split("@")[0] || "User",
              full_name: profData.full_name || contextProfile?.full_name || "N/A",
              date_of_birth: profData.dob || profData.date_of_birth || "N/A",
              member_since: profData.created_at,
              preferred_currency: profData.preferred_currency || "USD",
              total_trade_volume: profData.trade_volume || "0.00",
              completed_trades: profData.completed_trades || 0,
              positive_feedback: profData.positive_feedback || 0,
              negative_feedback: profData.negative_feedback || 0,
              last_active: profData.last_active,
            };
          }
        }

        if (data) {
          setProfileData(data);
        } else if (contextProfile) {
          setProfileData({
            user_id: authUser?.uid,
            username: contextProfile.username || "User",
            full_name: contextProfile.full_name || "N/A",
            date_of_birth: contextProfile.dob || "N/A",
            member_since: contextProfile.created_at,
            preferred_currency: contextProfile.preferred_currency || "USD",
            total_trade_volume: contextProfile.trade_volume || "0.00",
            completed_trades: contextProfile.completed_trades || 0,
            positive_feedback: contextProfile.positive_feedback || 0,
            negative_feedback: contextProfile.negative_feedback || 0,
            last_active: contextProfile.last_active,
          });
        }
      } catch (err) {
        console.error("Error loading profile:", err);
      } finally {
        setLoading(false);
      }
    }

    if (!isAuthLoading) {
      if (!authUser) {
        router.push("/login");
      } else {
        loadCurrentProfile();
      }
    }
  }, [authUser, isAuthLoading, contextProfile, router]);

  if (loading || isAuthLoading) {
    return (
      <div className="flex justify-center items-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-[#5D45F9]" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 sm:p-6 space-y-6">
      {/* Account Stats */}
      <Card className="border shadow-sm">
        <CardHeader className="border-b pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg font-bold">Account Stats</CardTitle>
            <UserStatusIndicator lastActive={profileData?.last_active} />
          </div>
        </CardHeader>
        <CardContent className="pt-4 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <span className="text-xs text-muted-foreground">Total Trade Volume</span>
            <p className="text-lg font-bold">${profileData?.total_trade_volume || "0"}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Completed Trades</span>
            <p className="text-lg font-bold">{profileData?.completed_trades || 0}</p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Positive Feedback</span>
            <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
              {profileData?.positive_feedback || 0}
            </p>
          </div>
          <div>
            <span className="text-xs text-muted-foreground">Negative Feedback</span>
            <p className="text-lg font-bold text-rose-600 dark:text-rose-400">
              {profileData?.negative_feedback || 0}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* User Information */}
      <Card className="border shadow-sm">
        <CardHeader className="border-b pb-3">
          <CardTitle className="text-lg font-bold">User Information</CardTitle>
          <p className="text-xs text-muted-foreground">
            This information is private and not shared with other traders.
          </p>
        </CardHeader>
        <CardContent className="pt-4 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <span className="text-xs text-muted-foreground font-medium">Full Name</span>
              <p className="text-sm font-semibold">{profileData?.full_name || "N/A"}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground font-medium">User ID</span>
              <p className="text-sm font-mono font-bold text-[#5D45F9]">
                @{profileData?.username || "N/A"}
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground font-medium">Date of Birth</span>
              <p className="text-sm font-semibold">{profileData?.date_of_birth || "N/A"}</p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground font-medium">Member Since</span>
              <p className="text-sm font-semibold">
                {profileData?.member_since
                  ? new Date(profileData.member_since).toLocaleDateString()
                  : "N/A"}
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground font-medium">Preferred Currency</span>
              <p className="text-sm font-semibold">{profileData?.preferred_currency || "USD"} </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
