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
        const PUBLIC_PROFILE_COLUMNS = 'id, username, display_name, avatar_url, photo_url, country, is_verified, id_verified, kyc_status, is_online, last_seen_at, created_at, total_completed_trades, completed_trades, trade_volume, positive_feedback, negative_feedback, feedback_score';
        const [profileRes, statsRes] = await Promise.all([
          supabase.from("profiles").select(PUBLIC_PROFILE_COLUMNS).eq("id", userId).maybeSingle(),
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
