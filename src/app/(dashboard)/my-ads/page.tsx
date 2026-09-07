"use client";

import { useAuth } from "@/components/providers/auth-provider";
import { supabase } from "@/lib/supabase/client";
import type { P2PAd, CryptoCurrency } from "@/lib/types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Edit, Plus, Trash2, Loader2, PlusCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { softDeleteAd, updateAdStatus } from "@/lib/ads";
import Link from "next/link";
import ManageAds, { AdItem } from "@/components/ManageAds";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";

export default function MyAdsPage() {
  const { user, isUserLoading } = useAuth();
  const router = useRouter();
  const { toast } = useToast();

  const [ads, setAds] = useState<P2PAd[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  const fetchMyAds = useCallback(async () => {
    setIsLoading(true);
    try {
      // Always fetch active user session directly
      const { data: authData } = await supabase.auth.getUser();
      const currentUser = authData?.user;

      if (!currentUser) {
        setIsLoading(false);
        return;
      }

      // Fetch user's ads via API route
      let rawAds: any[] = [];
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers: Record<string, string> = {};
        if (session?.access_token) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }
        const apiRes = await fetch('/api/p2p/my-ads', {
          headers,
          credentials: 'include',
        });
        if (apiRes.ok) {
          const json = await apiRes.json();
          if (Array.isArray(json.ads)) rawAds = json.ads;
        }
      } catch (apiErr) {
        console.warn("API /api/p2p/my-ads error, fallback to direct query:", apiErr);
      }

      if (rawAds.length === 0) {
        const { data, error } = await supabase
          .from('p2p_ads')
          .select('*')
          .eq('user_id', currentUser.id)
          .order('created_at', { ascending: false });

        if (error) {
          console.error("My Ads fetch error:", error.message);
          throw error;
        }
        rawAds = data || [];
      }

      const mapped: P2PAd[] = rawAds.map((raw: any) => {
        const rawType = (raw.type || raw.ad_type || raw.adType || 'sell').toLowerCase();
        const isMarket = raw.pricing_type === 'FLOAT' || raw.rate_type === 'market';
        const priceVal = raw.price != null ? Number(raw.price) : (raw.fixed_rate ?? raw.fixedRate);
        const isActive = raw.status ? (raw.status.toLowerCase() === 'active') : (raw.active !== false);

        return {
          id: raw.id,
          userId: raw.user_id || raw.userId,
          publicAdId: raw.public_ad_id || raw.publicAdId || raw.id,
          adType: (rawType === 'buy' ? 'buy' : 'sell') as 'buy' | 'sell',
          crypto: (raw.coin || raw.crypto || raw.crypto_currency || 'USDT') as CryptoCurrency,
          fiatCurrency: raw.fiat || raw.fiat_currency || raw.fiatCurrency || 'USD',
          rateType: isMarket ? 'market' : 'fixed',
          fixedRate: priceVal,
          ratePercent: Number(raw.margin_percentage ?? raw.rate_percent ?? raw.ratePercent ?? 0),
          minAmount: Number(raw.min_amount ?? raw.minAmount ?? 0),
          maxAmount: Number(raw.max_amount ?? raw.maxAmount ?? 0),
          paymentMethods: Array.isArray(raw.payment_methods)
            ? raw.payment_methods
            : Array.isArray(raw.paymentMethods)
            ? raw.paymentMethods
            : typeof raw.payment_methods === 'string'
            ? JSON.parse(raw.payment_methods)
            : ['Bank Transfer'],
          terms: raw.terms || '',
          active: isActive,
          createdAt: raw.created_at || raw.createdAt,
        };
      });

      setAds(mapped);
    } catch (err: any) {
      console.error('Error fetching my ads:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMyAds();
  }, [fetchMyAds]);

  const handleStatusToggle = async (adId: string, currentStatus: boolean) => {
    try {
      await updateAdStatus(null, adId, !currentStatus);
      setAds((prev) =>
        prev.map((a) => (a.id === adId ? { ...a, active: !currentStatus } : a))
      );
      toast({
        title: "Ad Updated",
        description: `Your ad has been ${!currentStatus ? "activated" : "deactivated"}.`,
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Update Failed", description: e.message });
    }
  };

  const handleDelete = async (adId: string) => {
    try {
      await softDeleteAd(null, adId);
      setAds((prev) => prev.filter((a) => a.id !== adId));
      toast({
        title: "Ad Deleted",
        description: "Your ad has been removed from public listings.",
      });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Delete Failed", description: e.message });
    }
  };

  if (isUserLoading || !user) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-[#5D45F9]" />
      </div>
    );
  }

  const formattedManageAds: AdItem[] = ads.map((ad) => ({
    id: ad.id,
    type: (ad.adType === 'buy' ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
    asset: ad.crypto,
    fiat_currency: ad.fiatCurrency,
    price: Number(ad.fixedRate || 0),
    pricing_type: ad.rateType === 'fixed' ? 'FIXED' : 'FLOAT',
    margin_percent: ad.ratePercent,
    status: ad.active ? 'ACTIVE' : 'INACTIVE',
    min_limit: ad.minAmount,
    max_limit: ad.maxAmount,
    available_amount: ad.maxAmount,
    payment_methods: ad.paymentMethods,
    terms_conditions: ad.terms,
    created_at: typeof ad.createdAt === 'string' ? ad.createdAt : new Date().toISOString(),
  }));

  return (
    <div className="space-y-6">
      {/* Clean Solid Header with Zero Glassmorphism */}
      <div className="bg-card text-card-foreground border border-border py-6 px-6 sm:px-8 rounded-2xl shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-[#9273FC] bg-[#9273FC]/10 dark:bg-[#9273FC]/20 px-2.5 py-0.5 rounded-md">
                Peer-to-Peer Market
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
              My Posted Ads
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              Manage your active P2P buy and sell offers, set limits, and adjust pricing.
            </p>
          </div>
          <Link
            href="/ads/create"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#9273FC] hover:bg-[#4F46E5] text-white font-bold text-sm rounded-xl shadow-sm transition-all active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Ad</span>
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="p-12 text-center rounded-2xl bg-slate-900 border border-slate-800">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-[#5D45F9]" />
          <p className="text-xs text-slate-400 mt-2">Loading your advertisements...</p>
        </div>
      ) : (
        <ManageAds ads={formattedManageAds} />
      )}
    </div>
  );
}
