"use client";

import { useParams } from "next/navigation";
import { useAuth } from "@/components/providers/auth-provider";
import { supabase } from "@/lib/supabase/client";
import type { P2PAd, CryptoCurrency } from "@/lib/types";
import { CreateAdForm } from "@/components/p2p/create-ad-form";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

export default function EditAdPage() {
  const params = useParams();
  const { user } = useAuth();
  const adId = Array.isArray(params.adId) ? params.adId[0] : params.adId;

  const [ad, setAd] = useState<P2PAd | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadAd() {
      if (!adId) return;
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('p2p_ads')
          .select('*')
          .eq('id', adId)
          .single();

        if (error) throw error;

        if (data) {
          const mapped: P2PAd = {
            id: data.id,
            userId: data.user_id || data.userId,
            publicAdId: data.public_ad_id || data.publicAdId || data.id,
            adType: (data.ad_type || data.adType || 'sell') as 'buy' | 'sell',
            crypto: data.crypto as CryptoCurrency,
            fiatCurrency: data.fiat_currency || data.fiatCurrency || 'USD',
            rateType: data.rate_type || data.rateType || 'market',
            fixedRate: data.fixed_rate ?? data.fixedRate,
            ratePercent: data.rate_percent ?? data.ratePercent ?? 0,
            minAmount: Number(data.min_amount ?? data.minAmount ?? 0),
            maxAmount: Number(data.max_amount ?? data.maxAmount ?? 0),
            paymentMethods: Array.isArray(data.payment_methods)
              ? data.payment_methods
              : Array.isArray(data.paymentMethods)
              ? data.paymentMethods
              : typeof data.payment_methods === 'string'
              ? JSON.parse(data.payment_methods)
              : [],
            offerLabel: data.offer_label || data.offerLabel,
            tags: Array.isArray(data.tags) ? data.tags : [],
            terms: data.terms || '',
            paymentTimeLimit: Number(data.payment_time_limit ?? data.paymentTimeLimit ?? 30),
            active: data.active !== false,
            targetedCountries: data.targeted_countries || data.targetedCountries || [],
            blockedCountries: data.blocked_countries || data.blockedCountries || [],
            minCompletedTrades: Number(data.min_completed_trades ?? data.minCompletedTrades ?? 0),
            createdAt: data.created_at || data.createdAt,
          };
          setAd(mapped);
        }
      } catch (err) {
        console.error('Error fetching ad to edit:', err);
      } finally {
        setIsLoading(false);
      }
    }
    loadAd();
  }, [adId]);

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!ad) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Ad not found</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  // Ensure only the ad owner can edit
  if (user && ad.userId !== user.uid) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Unauthorized</CardTitle>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="flex-1 rounded-lg">
      <CreateAdForm ad={ad} adType={ad.adType} />
    </div>
  );
}
