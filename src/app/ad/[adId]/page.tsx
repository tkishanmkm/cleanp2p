import React from "react";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase/client";
import { UserStatusIndicator } from "@/components/user-status";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AdDetailTradeAction } from "@/components/p2p/ad-detail-trade-action";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export default async function AdDetailPage({ params }: { params: { adId: string } }) {
  const { adId } = params;

  if (!adId) {
    notFound();
  }

  // 1. Try fetching from ads table
  let { data: ad, error } = await supabase
    .from("ads")
    .select(`
      *,
      profiles (
        id,
        username,
        full_name,
        last_active
      )
    `)
    .eq("id", adId)
    .maybeSingle();

  // 2. Fallback to p2p_ads table if not in ads table
  if (!ad || error) {
    const { data: p2pAd, error: p2pError } = await supabase
      .from("p2p_ads")
      .select("*")
      .or(`id.eq.${adId},public_ad_id.eq.${adId}`)
      .maybeSingle();

    if (p2pError || !p2pAd) {
      notFound();
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("id, username, full_name, last_active")
      .or(`id.eq.${p2pAd.user_id},username.eq.${p2pAd.user_id}`)
      .maybeSingle();

    ad = {
      id: p2pAd.id,
      user_id: p2pAd.user_id,
      type: (p2pAd.ad_type || 'SELL').toUpperCase(),
      asset_symbol: p2pAd.crypto,
      fiat_symbol: p2pAd.fiat_currency,
      price: p2pAd.fixed_rate ?? p2pAd.price,
      total_amount: p2pAd.total_amount ?? p2pAd.max_amount,
      min_limit: p2pAd.min_amount,
      max_limit: p2pAd.max_amount,
      payment_methods: Array.isArray(p2pAd.payment_methods)
        ? p2pAd.payment_methods
        : typeof p2pAd.payment_methods === 'string'
        ? JSON.parse(p2pAd.payment_methods)
        : [],
      profiles: profile,
    };
  }

  const sellerProfile = Array.isArray(ad.profiles) ? ad.profiles[0] : ad.profiles;
  const paymentMethodsList = Array.isArray(ad.payment_methods)
    ? ad.payment_methods.join(", ")
    : typeof ad.payment_methods === "string"
    ? ad.payment_methods
    : "None specified";

  return (
    <div className="max-w-3xl mx-auto p-4 sm:p-6 space-y-6">
      <Link
        href="/buy"
        className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="w-4 h-4 mr-1.5" />
        Back to Marketplace
      </Link>

      <Card>
        <CardHeader className="border-b pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl font-bold">
                {ad.type} {ad.asset_symbol} with {ad.fiat_symbol}
              </CardTitle>
              <p className="text-xs text-muted-foreground mt-1">Ad ID: {ad.id}</p>
            </div>
            <span
              className={`px-3 py-1 text-xs font-semibold rounded-full ${
                ad.type === "BUY" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300" : "bg-purple-100 text-purple-700 dark:bg-purple-950 dark:text-purple-300"
              }`}
            >
              {ad.type} AD
            </span>
          </div>
        </CardHeader>
        <CardContent className="pt-6 space-y-6">
          {/* Advertiser Profile Info */}
          <div className="flex items-center justify-between p-4 bg-muted/40 rounded-lg">
            <div>
              <p className="font-semibold text-base">
                {sellerProfile?.full_name || sellerProfile?.username || "Trader"}
              </p>
              <p className="text-xs text-muted-foreground">@{sellerProfile?.username || "trader"}</p>
            </div>
            <UserStatusIndicator lastActive={sellerProfile?.last_active} />
          </div>

          {/* Ad Details Grid */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <span className="text-xs text-muted-foreground">Price</span>
              <p className="text-lg font-bold text-foreground">
                {ad.price} {ad.fiat_symbol}
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Total Available</span>
              <p className="text-lg font-bold text-foreground">
                {ad.total_amount || ad.max_limit} {ad.asset_symbol}
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Order Limits</span>
              <p className="text-sm font-semibold text-foreground">
                {ad.min_limit} - {ad.max_limit} {ad.fiat_symbol}
              </p>
            </div>
            <div>
              <span className="text-xs text-muted-foreground">Payment Methods</span>
              <p className="text-sm font-semibold text-foreground">
                {paymentMethodsList || "None specified"}
              </p>
            </div>
          </div>

          <AdDetailTradeAction ad={ad} />
        </CardContent>
      </Card>
    </div>
  );
}
