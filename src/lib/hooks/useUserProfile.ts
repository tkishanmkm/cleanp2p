import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";

export function useUserProfile(userId: string | undefined) {
  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setLoading(false);
      return;
    }

    async function loadData() {
      setLoading(true);

      try {
        // Fetch Profile Info & Computed Stats in parallel
        const [profileRes, statsRes] = await Promise.all([
          supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
          supabase.from("user_account_stats").select("*").eq("user_id", userId).maybeSingle()
        ]);

        if (profileRes.data) {
          setProfile(profileRes.data);
        }
        if (statsRes.data) {
          setStats(statsRes.data);
        }
      } catch (err) {
        console.error("Error fetching user profile & stats:", err);
      } finally {
        setLoading(false);
      }
    }

    loadData();
  }, [userId]);

  return { profile, stats, loading };
}

export default useUserProfile;
