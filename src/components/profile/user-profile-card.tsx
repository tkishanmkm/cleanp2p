"use client";

import React from "react";
import { useUserProfile } from "@/lib/hooks/useUserProfile";
import { Skeleton } from "@/components/ui/skeleton";

export function UserProfileCard({ userId }: { userId: string }) {
  const { profile, loading } = useUserProfile(userId);

  if (loading) {
    return (
      <div className="space-y-4 border border-border p-6 rounded-xl bg-card">
        <Skeleton className="h-6 w-1/3 mb-2" />
        <Skeleton className="h-4 w-1/4" />
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 border border-border p-6 rounded-xl bg-card text-card-foreground">
      <div>
        <h3 className="text-lg font-bold">{profile?.full_name || profile?.username || "N/A"}</h3>
        <p className="text-sm text-muted-foreground">User ID: @{profile?.username || "N/A"}</p>
      </div>

      <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border">
        <div>
          <span className="text-xs text-muted-foreground">Full Name</span>
          <p className="font-medium">{profile?.full_name || "N/A"}</p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Date of Birth</span>
          <p className="font-medium">{profile?.date_of_birth || profile?.dob || "N/A"}</p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Member Since</span>
          <p className="font-medium">
            {profile?.created_at ? new Date(profile.created_at).toLocaleDateString() : "N/A"}
          </p>
        </div>
        <div>
          <span className="text-xs text-muted-foreground">Preferred Currency</span>
          <p className="font-medium">{profile?.preferred_currency || "USD"}</p>
        </div>
      </div>
    </div>
  );
}

export default UserProfileCard;
