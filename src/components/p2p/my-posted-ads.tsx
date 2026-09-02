"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase/client";
import { AdCard } from "@/components/p2p/ad-card";
import { Loader2 } from "lucide-react";
import type { P2PAd, CryptoCurrency } from "@/lib/types";

function normalizeUserAd(raw: any): P2PAd {
  const profile = Array.isArray(raw.user) ? raw.user[0] : raw.user || {};
  return {
    id: raw.id,
    userId: raw.user_id || raw.userId,
    publicAdId: raw.public_ad_id || raw.publicAdId || raw.id,
    adType: (raw.ad_type || raw.adType || raw.type || 'sell') as 'buy' | 'sell',
    crypto: (raw.crypto || raw.coin || raw.crypto_currency || 'USDT') as CryptoCurrency,
    fiatCurrency: raw.fiat_currency || raw.fiatCurrency || raw.fiat || 'USD',
    rateType: raw.rate_type || raw.rateType || (raw.pricing_type === 'FLOAT' ? 'market' : 'fixed'),
    fixedRate: raw.fixed_rate ?? raw.fixedRate ?? raw.price,
    ratePercent: raw.rate_percent ?? raw.ratePercent ?? raw.margin_percentage ?? 0,
    minAmount: Number(raw.min_amount ?? raw.minAmount ?? 0),
    maxAmount: Number(raw.max_amount ?? raw.maxAmount ?? 0),
    paymentMethods: Array.isArray(raw.payment_methods)
      ? raw.payment_methods
      : Array.isArray(raw.paymentMethods)
      ? raw.paymentMethods
      : typeof raw.payment_methods === 'string'
      ? JSON.parse(raw.payment_methods)
      : ['Bank Transfer'],
    offerLabel: raw.offer_label || raw.offerLabel,
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    terms: raw.terms || '',
    paymentTimeLimit: Number(raw.payment_time_limit ?? raw.paymentTimeLimit ?? 30),
    active: raw.active !== false && raw.status !== 'archived' && raw.status !== 'deleted',
    targetedCountries: raw.targeted_countries || raw.targetedCountries || [],
    blockedCountries: raw.blocked_countries || raw.blockedCountries || [],
    minCompletedTrades: Number(raw.min_completed_trades ?? raw.minCompletedTrades ?? 0),
    createdAt: raw.created_at || raw.createdAt,
    user: {
      username: profile.username || raw.user_display_name || raw.username || 'trader',
      country: profile.country || raw.country,
      feedbackScore: profile.feedback_score ?? 100,
      positiveFeedback: profile.positive_feedback ?? 0,
      negativeFeedback: profile.negative_feedback ?? 0,
      completedTrades: profile.completed_trades ?? 0,
      photoURL: profile.photo_url || profile.photoURL || raw.photo_url,
      badges: profile.badges || [],
      lastActive: profile.last_active || profile.lastActive,
      isVerified: profile.is_verified ?? false,
    },
  };
}

export function MyPostedAdsSection({ userId }: { userId: string }) {
  const [ads, setAds] = useState<P2PAd[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUserAds() {
      if (!userId) return;
      setLoading(true);

      try {
        // Try querying p2p_ads first, with fallback to ads
        let result = await supabase
          .from("p2p_ads")
          .select(`
            *,
            user:profiles (
              id,
              username,
              country,
              feedback_score,
              positive_feedback,
              negative_feedback,
              completed_trades,
              photo_url,
              badges,
              last_active,
              is_verified
            )
          `)
          .eq("user_id", userId)
          .order("created_at", { ascending: false });

        if (result.error) {
          result = await supabase
            .from("ads")
            .select(`
              *,
              user:profiles (
                id,
                username,
                last_active
              )
            `)
            .eq("user_id", userId)
            .order("created_at", { ascending: false });
        }

        if (result.error) {
          console.error("Error loading user ads:", result.error);
          setAds([]);
        } else {
          const normalized = (result.data || []).map(normalizeUserAd);
          setAds(normalized);
        }
      } catch (err) {
        console.error("Failed to load user ads:", err);
      } finally {
        setLoading(false);
      }
    }

    loadUserAds();
  }, [userId]);

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (ads.length === 0) {
    return (
      <div className="text-center p-8 border rounded-lg border-dashed text-muted-foreground">
        No active buy or sell ads posted yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {ads.map((ad) => (
        <AdCard key={ad.id} ad={ad} />
      ))}
    </div>
  );
}

export default MyPostedAdsSection;
