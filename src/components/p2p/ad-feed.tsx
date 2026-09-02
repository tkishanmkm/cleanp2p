"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase/client";
import { UserStatusIndicator } from "@/components/user-status";
import { Button } from "@/components/ui/button";
import { TradeInitiationModal, AdData } from "@/components/p2p/trade-initiation-modal";
import { Loader2 } from "lucide-react";

export function AdFeed({ type }: { type?: "BUY" | "SELL" }) {
  const [ads, setAds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedAd, setSelectedAd] = useState<AdData | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const handleOpenTradeModal = (ad: AdData) => {
    setSelectedAd(ad);
    setIsModalOpen(true);
  };

  useEffect(() => {
    async function fetchAds() {
      setLoading(true);

      try {
        let query = supabase
          .from("ads")
          .select(`
            id,
            type,
            asset_symbol,
            fiat_symbol,
            price,
            min_limit,
            max_limit,
            payment_methods,
            created_at,
            user_id,
            profiles (
              id,
              username,
              full_name,
              last_active
            )
          `)
          .eq("is_active", true)
          .order("created_at", { ascending: false });

        if (type) {
          query = query.eq("type", type);
        }

        const { data, error } = await query;

        if (error) {
          // Fallback query to p2p_ads if standard ads schema differs
          let fallbackQuery = supabase
            .from("p2p_ads")
            .select(`
              id,
              ad_type,
              crypto,
              fiat_currency,
              fixed_rate,
              min_amount,
              max_amount,
              payment_methods,
              created_at,
              user_id
            `)
            .order("created_at", { ascending: false });

          if (type) {
            fallbackQuery = fallbackQuery.eq("ad_type", type.toLowerCase());
          }

          const { data: p2pData, error: p2pError } = await fallbackQuery;

          if (p2pError) {
            console.error("Error fetching ads:", error, p2pError);
            setAds([]);
          } else if (p2pData && p2pData.length > 0) {
            const userIds = Array.from(new Set(p2pData.map((d: any) => d.user_id).filter(Boolean)));
            const { data: profiles } = await supabase
              .from("profiles")
              .select("id, username, full_name, last_active")
              .in("id", userIds);

            const profileMap = new Map((profiles || []).map((p: any) => [p.id, p]));
            const mapped = p2pData.map((ad: any) => ({
              id: ad.id,
              type: (ad.ad_type || 'sell').toUpperCase(),
              asset_symbol: ad.crypto,
              fiat_symbol: ad.fiat_currency,
              price: ad.fixed_rate,
              min_limit: ad.min_amount,
              max_limit: ad.max_amount,
              payment_methods: ad.payment_methods,
              created_at: ad.created_at,
              profiles: profileMap.get(ad.user_id),
            }));
            setAds(mapped);
          } else {
            setAds([]);
          }
        } else {
          setAds(data || []);
        }
      } catch (err) {
        console.error("Error fetching ads:", err);
        setAds([]);
      } finally {
        setLoading(false);
      }
    }

    fetchAds();
  }, [type]);

  if (loading) {
    return (
      <div className="flex justify-center items-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (ads.length === 0) {
    return (
      <div className="text-center py-12 border border-dashed rounded-lg text-muted-foreground">
        No active ads found.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {ads.map((ad) => {
        const sellerProfile = Array.isArray(ad.profiles) ? ad.profiles[0] : ad.profiles;
        return (
          <div
            key={ad.id}
            className="p-4 border rounded-xl flex items-center justify-between hover:border-primary/50 transition-colors"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-base">
                  {sellerProfile?.full_name || sellerProfile?.username || "Trader"}
                </span>
                <UserStatusIndicator lastActive={sellerProfile?.last_active} />
              </div>
              <p className="text-xs text-muted-foreground">
                @{sellerProfile?.username || "user"} • ID: <span className="font-mono">{ad.id}</span>
              </p>
            </div>

            <div className="flex items-center gap-6">
              <div className="text-right">
                <p className="text-lg font-bold">
                  {ad.price} {ad.fiat_symbol}
                </p>
                <p className="text-xs text-muted-foreground">
                  Limit: {ad.min_limit} - {ad.max_limit} {ad.fiat_symbol}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Link
                  href={`/ad/${ad.id}`}
                  className="px-3 py-2 text-xs font-medium border border-border text-muted-foreground hover:text-foreground rounded-lg transition-colors"
                >
                  Details
                </Link>
                <Button
                  onClick={() => handleOpenTradeModal(ad)}
                  className="px-4 py-2 text-sm font-medium bg-[#5D45F9] hover:bg-[#4833D8] text-white rounded-lg transition-colors h-auto"
                >
                  {ad.type === "BUY" ? "Sell" : "Buy"} {ad.asset_symbol}
                </Button>
              </div>
            </div>
          </div>
        );
      })}

      <TradeInitiationModal
        ad={selectedAd}
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
      />
    </div>
  );
}

export default AdFeed;
