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

      const { data, error } = await supabase
        .from('p2p_ads')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false });

      if (error) {
        console.error("My Ads fetch error:", error.message);
        throw error;
      }

      const mapped: P2PAd[] = (data || []).map((raw: any) => {
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

  return (
    <div className="space-y-6">
      {/* Theme Styled Header matching /buy & /sell page banner */}
      <div className="bg-[#5D45F9] text-white py-8 px-6 rounded-2xl shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              My Posted Ads
            </h1>
            <p className="text-white/80 text-sm mt-1">
              Manage your active P2P buy and sell offers, set limits, and adjust pricing.
            </p>
          </div>
          <Link
            href="/ads/create"
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 bg-white text-[#5D45F9] font-semibold text-sm rounded-lg hover:bg-white/90 transition-colors shadow-sm"
          >
            <Plus className="w-4 h-4" />
            <span>Create New Ad</span>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Manage Your Ads</CardTitle>
          <CardDescription>
            Here you can view, activate, deactivate, and delete your ads.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ad ID</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Asset</TableHead>
                <TableHead>Price</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin mx-auto text-[#5D45F9]" />
                  </TableCell>
                </TableRow>
              )}
              {!isLoading &&
                ads?.map((ad) => (
                  <TableRow key={ad.id}>
                    <TableCell className="font-mono text-xs font-semibold">{ad.publicAdId}</TableCell>
                    <TableCell className="capitalize font-medium">{ad.adType}</TableCell>
                    <TableCell>
                      {ad.crypto}/{ad.fiatCurrency}
                    </TableCell>
                    <TableCell>
                      {ad.rateType === "fixed"
                        ? `${ad.fixedRate} ${ad.fiatCurrency}`
                        : `Market ${ad.ratePercent}%`}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ad.active ? "default" : "outline"} className={ad.active ? "bg-emerald-600 hover:bg-emerald-700" : ""}>
                        {ad.active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Switch
                          checked={ad.active}
                          onCheckedChange={() => handleStatusToggle(ad.id, !!ad.active)}
                          aria-label="Toggle ad status"
                        />
                        <Button asChild variant="ghost" size="icon">
                          <Link href={`/ads/edit/${ad.id}`}>
                            <Edit className="h-4 w-4" />
                          </Link>
                        </Button>
                        <AlertDialog>
                          <AlertDialogTrigger asChild>
                            <Button variant="ghost" size="icon" className="text-destructive">
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </AlertDialogTrigger>
                          <AlertDialogContent>
                            <AlertDialogHeader>
                              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                              <AlertDialogDescription>
                                This will permanently deactivate your ad.
                              </AlertDialogDescription>
                            </AlertDialogHeader>
                            <AlertDialogFooter>
                              <AlertDialogCancel>Cancel</AlertDialogCancel>
                              <AlertDialogAction
                                onClick={() => handleDelete(ad.id)}
                                className="bg-destructive hover:bg-destructive/90"
                              >
                                Delete
                              </AlertDialogAction>
                            </AlertDialogFooter>
                          </AlertDialogContent>
                        </AlertDialog>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              {!isLoading && !ads?.length && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24 text-muted-foreground">
                    You haven't created any ads yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
