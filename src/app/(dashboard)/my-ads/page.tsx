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
import { Edit, PlusCircle, Trash2, Loader2 } from "lucide-react";
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
    if (!user?.uid) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('p2p_ads')
        .select('*')
        .or(`user_id.eq.${user.uid},userId.eq.${user.uid}`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const mapped: P2PAd[] = (data || []).map((raw: any) => ({
        id: raw.id,
        userId: raw.user_id || raw.userId,
        publicAdId: raw.public_ad_id || raw.publicAdId || raw.id,
        adType: (raw.ad_type || raw.adType || 'sell') as 'buy' | 'sell',
        crypto: raw.crypto as CryptoCurrency,
        fiatCurrency: raw.fiat_currency || raw.fiatCurrency || 'USD',
        rateType: raw.rate_type || raw.rateType || 'market',
        fixedRate: raw.fixed_rate ?? raw.fixedRate,
        ratePercent: raw.rate_percent ?? raw.ratePercent ?? 0,
        minAmount: Number(raw.min_amount ?? raw.minAmount ?? 0),
        maxAmount: Number(raw.max_amount ?? raw.maxAmount ?? 0),
        paymentMethods: Array.isArray(raw.payment_methods)
          ? raw.payment_methods
          : Array.isArray(raw.paymentMethods)
          ? raw.paymentMethods
          : typeof raw.payment_methods === 'string'
          ? JSON.parse(raw.payment_methods)
          : [],
        terms: raw.terms || '',
        active: raw.active !== false,
        createdAt: raw.created_at || raw.createdAt,
      }));

      setAds(mapped);
    } catch (err: any) {
      console.error('Error fetching my ads:', err);
    } finally {
      setIsLoading(false);
    }
  }, [user?.uid]);

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
      <div className="flex flex-1 items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">My P2P Ads</h1>
        <Button asChild>
          <Link href="/ads/create">
            <PlusCircle className="mr-2 h-4 w-4" /> Create New Ad
          </Link>
        </Button>
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
                  <TableCell colSpan={6}>Loading ads...</TableCell>
                </TableRow>
              )}
              {!isLoading &&
                ads?.map((ad) => (
                  <TableRow key={ad.id}>
                    <TableCell className="font-mono text-xs">{ad.publicAdId}</TableCell>
                    <TableCell className="capitalize">{ad.adType}</TableCell>
                    <TableCell>
                      {ad.crypto}/{ad.fiatCurrency}
                    </TableCell>
                    <TableCell>
                      {ad.rateType === "fixed"
                        ? `${ad.fixedRate} ${ad.fiatCurrency}`
                        : `Market ${ad.ratePercent}%`}
                    </TableCell>
                    <TableCell>
                      <Badge variant={ad.active ? "default" : "outline"}>
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
                  <TableCell colSpan={6} className="text-center h-24">
                    You haven't created any ads yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
