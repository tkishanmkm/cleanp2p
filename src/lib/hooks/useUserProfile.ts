import { useEffect, useState } from "react";

export function useUserProfile(userId: string | undefined) {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (!userId) {
      setProfile(null);
      setLoading(false);
      return;
    }

    async function loadData() {
      setLoading(true);

      try {
        // Public profile reads must go through the server's explicit column
        // allowlist; browser roles have no direct SELECT grant on profiles.
        const response = await fetch(`/api/users/${encodeURIComponent(userId ?? "")}`, {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
        });

        if (!response.ok) {
          throw new Error(`Public profile request failed (${response.status})`);
        }

        const data = await response.json();
        const stats = data?.stats ?? {};
        const publicProfile = {
          id: data.id,
          username: typeof data.username === "string" ? data.username.replace(/^@/, "") : null,
          display_name: data.display_name ?? null,
          avatar_url: data.avatar_url ?? data.photo_url ?? null,
          photo_url: data.photo_url ?? data.avatar_url ?? null,
          country: data.country ?? null,
          is_verified: data.is_id_verified === true,
          is_online: data.is_online === true,
          last_seen_at: data.last_seen_at ?? data.last_seen ?? null,
          created_at: data.joined_at ?? data.created_at ?? null,
          total_completed_trades: stats.completed_trades ?? 0,
          completed_trades: stats.completed_trades ?? 0,
          trade_volume: stats.total_trade_volume ?? 0,
          total_trade_volume: stats.total_trade_volume ?? 0,
          positive_feedback: stats.positive_feedback_count ?? 0,
          negative_feedback: stats.negative_feedback_count ?? 0,
          feedback_score: stats.positive_feedback_pct ?? "100.0%",
        };

        if (!cancelled) setProfile(publicProfile);
      } catch (err) {
        if (!cancelled) {
          setProfile(null);
          console.error("Error fetching public user profile:", err);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadData();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  return { profile, loading };
}

export default useUserProfile;
