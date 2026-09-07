'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/utils/supabase/client';
import { getPublicHandle, formatCurrencyValue, parsePaymentMethods, getUserStatusText } from '@/utils/userPrivacy';
import { Loader2, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export default function AdsListPage() {
  const [ads, setAds] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAds() {
      setLoading(true);
      const supabase = createClient();

      const { data, error } = await supabase
        .from('ads')
        .select(`
          id,
          user_id,
          type,
          asset_symbol,
          fiat_symbol,
          price,
          min_limit,
          max_limit,
          total_amount,
          payment_methods,
          is_active,
          created_at,
          profiles:user_id (
            id,
            username,
            is_online,
            last_seen
          )
        `)
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (data && !error) {
        setAds(data);
      } else {
        // Fallback to p2p_ads if standard ads table is not populated
        const { data: p2pData } = await supabase
          .from('p2p_ads')
          .select(`
            id,
            user_id,
            type,
            asset_symbol,
            fiat_symbol,
            price,
            min_limit,
            max_limit,
            total_amount,
            payment_methods,
            is_active,
            created_at,
            profiles:user_id (
              id,
              username,
              is_online,
              last_seen
            )
          `)
          .eq('is_active', true)
          .order('created_at', { ascending: false });

        if (p2pData) setAds(p2pData);
      }
      setLoading(false);
    }

    loadAds();
  }, []);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Active P2P Offers</h1>
          <p className="text-sm text-muted-foreground">Browse all buy and sell offers on the platform</p>
        </div>
        <Button asChild>
          <Link href="/ads/create">Create Ad</Link>
        </Button>
      </div>

      {loading ? (
        <div className="p-12 text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <span className="text-xs text-muted-foreground mt-2 block">Loading offers...</span>
        </div>
      ) : ads.length === 0 ? (
        <div className="p-12 text-center border border-dashed rounded-2xl bg-card">
          <p className="text-sm text-muted-foreground">No active advertisements found.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {ads.map((ad) => {
            const displayUsername = getPublicHandle(ad.profiles);
            const methods = parsePaymentMethods(ad.payment_methods);
            const status = getUserStatusText(ad.profiles?.is_online, ad.profiles?.last_seen);

            return (
              <div
                key={ad.id}
                className="p-5 rounded-2xl border border-border bg-card flex flex-col md:flex-row md:items-center justify-between gap-4 transition hover:border-primary/50"
              >
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-foreground text-base">
                      {displayUsername}
                    </span>
                    <span className="text-[11px] text-muted-foreground font-mono">
                      ({status})
                    </span>
                    <Badge variant={ad.type?.toLowerCase() === 'sell' ? 'default' : 'secondary'}>
                      {ad.type?.toUpperCase()} {ad.asset_symbol}
                    </Badge>
                  </div>

                  <div className="text-xs text-muted-foreground space-x-2">
                    <span>
                      Limits: {formatCurrencyValue(Number(ad.min_limit), ad.fiat_symbol)} -{' '}
                      {formatCurrencyValue(Number(ad.max_limit), ad.fiat_symbol)}
                    </span>
                    <span>•</span>
                    <span>
                      Available: {Number(ad.total_amount || 0).toFixed(4)} {ad.asset_symbol}
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1 pt-1">
                    {methods.map((method, idx) => (
                      <Badge key={idx} variant="outline" className="text-[10px]">
                        {method}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="flex items-center justify-between md:flex-col md:items-end gap-2">
                  <div className="text-right">
                    <span className="text-xs text-muted-foreground uppercase block font-medium">Price</span>
                    <span className="text-xl font-bold text-foreground">
                      {formatCurrencyValue(Number(ad.price), ad.fiat_symbol)}
                    </span>
                  </div>

                  <Button asChild size="sm">
                    <Link href={`/ad/${ad.id}`}>
                      {ad.type?.toLowerCase() === 'sell' ? 'Buy' : 'Sell'} <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                    </Link>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
