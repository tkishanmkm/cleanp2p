"use client";

import { useAuth } from "@/components/providers/auth-provider";
import { supabase } from "@/lib/supabase/client";
import type { P2PAd, CryptoCurrency } from "@/lib/types";
import { Loader2, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { softDeleteAd, updateAdStatus } from "@/lib/ads";
import Link from "next/link";
import ManageAds, { AdItem } from "@/components/ManageAds";
import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@/context/wallet-context";

export default function MyAdsPage() {
  const { user, isUserLoading } = useAuth();
  const { balances: walletContextBalances } = useWallet();
  const router = useRouter();
  const { toast } = useToast();

  const [ads, setAds] = useState<any[]>([]);
  const [userCoinBalances, setUserCoinBalances] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isUserLoading && !user) {
      router.push('/login');
    }
  }, [user, isUserLoading, router]);

  const fetchMyAds = useCallback(async () => {
    setIsLoading(true);
    try {
      const { data: authData } = await supabase.auth.getUser();
      const currentUser = authData?.user;

      if (!currentUser) {
        setIsLoading(false);
        return;
      }

      let rawAds: any[] = [];
      let fetchedBalances: Record<string, number> = {};

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
          if (json.balances) fetchedBalances = json.balances;
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
          console.warn("My Ads p2p_ads fetch error, fallback to ads table:", error.message);
          const { data: adsData } = await supabase
            .from('ads')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('created_at', { ascending: false });
          rawAds = adsData || [];
        } else {
          rawAds = data || [];
        }
      }

      // Also query live balances directly from client supabase to ensure accuracy
      try {
        const [
          { data: walletAssets },
          { data: userWallets }
        ] = await Promise.all([
          supabase.from('wallet_assets').select('*').eq('user_id', currentUser.id),
          supabase.from('user_wallets').select('*').eq('user_id', currentUser.id),
        ]);

        if (walletAssets && Array.isArray(walletAssets)) {
          walletAssets.forEach((wa: any) => {
            const sym = String(wa.asset_symbol || wa.asset_code || wa.symbol || wa.crypto || '').toUpperCase();
            const avail = Number(wa.available ?? wa.balance ?? 0) - Number(wa.locked_escrow ?? wa.locked_balance ?? 0);
            if (sym && !isNaN(avail)) {
              fetchedBalances[sym] = Math.max(fetchedBalances[sym] || 0, Math.max(0, avail));
            }
          });
        }

        if (userWallets && Array.isArray(userWallets)) {
          userWallets.forEach((w: any) => {
            const sym = String(w.asset_symbol || '').toUpperCase();
            const avail = Number(w.available_balance ?? (Number(w.balance || 0) - Number(w.locked_balance || 0)));
            if (sym && !isNaN(avail)) {
              fetchedBalances[sym] = Math.max(fetchedBalances[sym] || 0, Math.max(0, avail));
            }
          });
        }
      } catch (balErr) {
        console.warn('Live balance query error in my-ads:', balErr);
      }

      setUserCoinBalances(fetchedBalances);
      setAds(rawAds);
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
        prev.map((a) => (a.id === adId ? { ...a, active: !currentStatus, status: !currentStatus ? 'ACTIVE' : 'INACTIVE' } : a))
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
        <Loader2 className="h-8 w-8 animate-spin text-[#6347ea]" />
      </div>
    );
  }

  const formattedManageAds: AdItem[] = ads.map((raw: any) => {
    const rawType = (raw.type || raw.ad_type || raw.adType || raw.side || 'SELL').toUpperCase();
    const coin = (raw.asset_symbol || raw.asset || raw.coin || raw.crypto || raw.crypto_currency || 'USDT').toUpperCase();
    const fiat = (raw.fiat_symbol || raw.fiat || raw.fiat_currency || raw.fiatCurrency || 'USD').toUpperCase();
    const isMarket = raw.pricing_type === 'FLOAT' || raw.rate_type === 'market' || raw.rate_type === 'floating';
    const priceVal = Number(raw.price ?? raw.fixed_rate ?? raw.fixedRate ?? raw.unit_price ?? 0);
    const isActive = raw.status ? (raw.status.toUpperCase() === 'ACTIVE') : (raw.is_active ?? raw.active ?? true);

    const minLimit = Number(raw.min_limit ?? raw.min_amount ?? raw.minAmount ?? 0);
    const maxLimit = Number(raw.max_limit ?? raw.max_amount ?? raw.maxAmount ?? 0);

    // Live available coin balance for Rule 3
    const contextBal = walletContextBalances[coin as CryptoCurrency]?.available;
    const directBal = userCoinBalances[coin];
    const adBal = raw.available_crypto ?? raw.available_amount;
    
    let liveCoinBalance = 0;
    if (contextBal !== undefined && contextBal >= 0) {
      liveCoinBalance = contextBal;
    } else if (directBal !== undefined && directBal >= 0) {
      liveCoinBalance = directBal;
    } else if (adBal !== undefined && adBal >= 0) {
      liveCoinBalance = Number(adBal);
    }

    let pMethods: string[] = ['Bank Transfer'];
    if (Array.isArray(raw.payment_methods)) pMethods = raw.payment_methods;
    else if (Array.isArray(raw.paymentMethods)) pMethods = raw.paymentMethods;
    else if (typeof raw.payment_methods === 'string') {
      try {
        const parsed = JSON.parse(raw.payment_methods);
        if (Array.isArray(parsed)) pMethods = parsed;
        else pMethods = [raw.payment_methods];
      } catch {
        pMethods = [raw.payment_methods];
      }
    }

    return {
      id: raw.id,
      type: rawType === 'BUY' ? 'BUY' : 'SELL',
      asset: coin,
      fiat_currency: fiat,
      price: priceVal,
      pricing_type: isMarket ? 'FLOAT' : 'FIXED',
      margin_percent: Number(raw.margin_percentage ?? raw.margin ?? raw.rate_percent ?? raw.ratePercent ?? 0),
      status: isActive ? 'ACTIVE' : 'INACTIVE',
      min_limit: minLimit,
      max_limit: maxLimit,
      available_amount: Number(liveCoinBalance.toFixed(6)),
      payment_methods: pMethods,
      terms_conditions: raw.terms_conditions || raw.terms || '',
      created_at: typeof raw.created_at === 'string' ? raw.created_at : new Date().toISOString(),
    };
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-card text-card-foreground border border-border py-6 px-6 sm:px-8 rounded-2xl shadow-xs">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-bold uppercase tracking-wider text-[#6347ea] bg-[#6347ea]/10 dark:bg-[#6347ea]/20 px-2.5 py-0.5 rounded-md">
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
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-[#6347ea] hover:bg-[#5238d6] text-white font-bold text-sm rounded-xl shadow-sm transition-all active:scale-[0.98]"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Ad</span>
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="p-12 text-center rounded-2xl bg-card border border-border">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-xs text-muted-foreground mt-2">Loading your advertisements...</p>
        </div>
      ) : (
        <ManageAds 
          ads={formattedManageAds} 
          onStatusChange={handleStatusToggle} 
          onDelete={handleDelete} 
        />
      )}
    </div>
  );
}
