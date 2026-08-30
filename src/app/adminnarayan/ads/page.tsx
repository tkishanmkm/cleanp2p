
"use client";

import { useFirebase } from "@/firebase";
import { collection, query, orderBy, getDocs, where } from "firebase/firestore";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import type { P2PAd, Trade } from "@/lib/types";
import { cn, toDate } from "@/lib/utils";
import Link from "next/link";
import { useAdminStatus } from "@/hooks/use-admin-status";
import { useState, useEffect, useMemo } from "react";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Edit, PlusCircle, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

export default function AdminAdsPage() {
  const { firestore } = useFirebase();
  const { isAdmin, isLoading: isAdminLoading } = useAdminStatus();
  const [ads, setAds] = useState<P2PAd[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const { toast } = useToast();
  const router = useRouter();

  const [selectedAd, setSelectedAd] = useState<P2PAd | null>(null);
  const [isDetailsOpen, setIsDetailsOpen] = useState(false);

  const [selectedAdStats, setSelectedAdStats] = useState<{
    totalTrades: number;
    completedTrades: number;
    cancelledTrades: number;
    expiredTrades: number;
    disputedTrades: number;
  } | null>(null);
  const [isStatsLoading, setIsStatsLoading] = useState(false);


  useEffect(() => {
    if (isAdminLoading) return;
    if (!isAdmin || !firestore) {
      setIsLoading(false);
      return;
    }

    const fetchAds = async () => {
      setIsLoading(true);
      try {
        const adsRef = collection(firestore, "p2p_ads");
        const q = query(adsRef, orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        setAds(snapshot.docs.map(doc => ({ ...doc.data(), id: doc.id } as P2PAd)));
      } catch (error) {
        console.error("Error fetching ads:", error);
        toast({ variant: "destructive", title: "Error", description: "Could not fetch ads." });
      } finally {
        setIsLoading(false);
      }
    };

    fetchAds();
  }, [isAdmin, isAdminLoading, firestore, toast]);

  const filteredAds = useMemo(() => {
    if (!ads) return null;
    if (!searchTerm.trim()) return ads;
    const lower = searchTerm.toLowerCase();
    return ads.filter(ad => 
        ad.publicAdId.toLowerCase().includes(lower) ||
        ad.user.username.toLowerCase().includes(lower) ||
        ad.crypto.toLowerCase().includes(lower) ||
        ad.fiatCurrency.toLowerCase().includes(lower)
    );
  }, [ads, searchTerm]);
  
  const fetchAdStats = async (adId: string) => {
    if (!firestore) return;
    setIsStatsLoading(true);
    setSelectedAdStats(null); // Reset stats
    try {
      const tradesQuery = query(collection(firestore, "trades"), where("adId", "==", adId));
      const snapshot = await getDocs(tradesQuery);
      const trades = snapshot.docs.map(doc => doc.data() as Trade);

      const stats = {
        totalTrades: trades.length,
        completedTrades: trades.filter(t => t.status === 'released').length,
        cancelledTrades: trades.filter(t => t.status === 'cancelled').length,
        expiredTrades: trades.filter(t => t.status === 'expired').length,
        disputedTrades: trades.filter(t => t.status === 'disputed').length,
      };
      setSelectedAdStats(stats);
    } catch (error) {
      console.error("Error fetching ad stats:", error);
      toast({ variant: "destructive", title: "Error", description: "Could not fetch ad statistics." });
    } finally {
      setIsStatsLoading(false);
    }
  };

  const handleRowClick = (ad: P2PAd) => {
    setSelectedAd(ad);
    setIsDetailsOpen(true);
    fetchAdStats(ad.id);
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">P2P Ads Management</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>All User Ads</CardTitle>
          <CardDescription>
            View all ads on the platform. Click a row to see details.
          </CardDescription>
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input 
              placeholder="Search by Ad ID, User ID, asset, or fiat..." 
              className="pl-10" 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <div className="hidden md:block">
            <Table>
                <TableHeader>
                <TableRow>
                    <TableHead>Ad ID</TableHead>
                    <TableHead>User</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Status</TableHead>
                </TableRow>
                </TableHeader>
                <TableBody>
                {isLoading && (
                    <TableRow>
                    <TableCell colSpan={5} className="text-center">
                        Loading ads...
                    </TableCell>
                    </TableRow>
                )}
                {!isLoading && filteredAds?.map((ad) => (
                    <TableRow key={ad.id} onClick={() => handleRowClick(ad)} className="cursor-pointer">
                    <TableCell className="font-mono text-xs">{ad.publicAdId}</TableCell>
                    <TableCell>
                        <Link href={`/users/${ad.user.username}`} className="hover:underline font-medium" onClick={(e) => e.stopPropagation()}>
                            {ad.user.username}
                        </Link>
                    </TableCell>
                    <TableCell>
                        <Badge variant={ad.adType === "sell" ? "secondary" : "outline"} className="capitalize">
                        {ad.adType}
                        </Badge>
                    </TableCell>
                    <TableCell>
                        {ad.rateType === "fixed"
                        ? `${ad.fixedRate} ${ad.fiatCurrency}`
                        : `Market ${ad.ratePercent}%`}
                    </TableCell>
                    <TableCell>
                        <Badge
                        variant="outline"
                        className={cn(
                            ad.active ? "text-green-600 border-green-500/50 bg-green-50" : "text-gray-600 border-gray-500/50 bg-gray-50"
                        )}
                        >
                        {ad.active ? "Active" : "Inactive"}
                        </Badge>
                    </TableCell>
                    </TableRow>
                ))}
                {!isLoading && !filteredAds?.length && (
                    <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                        No ads found.
                    </TableCell>
                    </TableRow>
                )}
                </TableBody>
            </Table>
          </div>
           <div className="grid gap-4 md:hidden">
              {isLoading && <p className="text-center text-sm text-muted-foreground py-4">Loading ads...</p>}
              {!isLoading && filteredAds?.map((ad) => (
                  <Card key={ad.id} onClick={() => handleRowClick(ad)} className="cursor-pointer">
                      <CardHeader className="flex flex-row items-center justify-between">
                          <div>
                            <CardTitle className="text-base">{ad.crypto}/{ad.fiatCurrency}</CardTitle>
                            <CardDescription className="font-mono text-xs">{ad.publicAdId}</CardDescription>
                          </div>
                          <Badge variant={ad.adType === "sell" ? "secondary" : "outline"} className="capitalize">{ad.adType}</Badge>
                      </CardHeader>
                      <CardContent className="text-sm space-y-2">
                           <div className="flex justify-between">
                            <span className="text-muted-foreground">User</span>
                            <span className="font-medium">{ad.user.username}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Price</span>
                             <span className="font-medium">{ad.rateType === "fixed" ? `${ad.fixedRate} ${ad.fiatCurrency}` : `Market ${ad.ratePercent}%`}</span>
                          </div>
                           <div className="flex justify-between">
                            <span className="text-muted-foreground">Status</span>
                             <Badge variant="outline" className={cn(ad.active ? "text-green-600 border-green-500/50 bg-green-50" : "text-gray-600 border-gray-500/50 bg-gray-50")}>
                                {ad.active ? "Active" : "Inactive"}
                            </Badge>
                          </div>
                      </CardContent>
                  </Card>
              ))}
               {!isLoading && !filteredAds?.length && <p className="text-center text-sm text-muted-foreground py-8">No ads found.</p>}
          </div>
        </CardContent>
      </Card>
      <Dialog open={isDetailsOpen} onOpenChange={setIsDetailsOpen}>
        <DialogContent className="sm:max-w-md">
            <DialogHeader>
                <DialogTitle>Ad Details</DialogTitle>
                <DialogDescription>Public Ad ID: {selectedAd?.publicAdId}</DialogDescription>
            </DialogHeader>
            {selectedAd && (
                 <div className="space-y-4 py-4 text-sm">
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">User</span><span className="font-medium">{selectedAd.user.username}</span></div>
                    {selectedAd.offerLabel && <div className="flex justify-between items-center"><span className="text-muted-foreground">Offer Label</span><Badge>{selectedAd.offerLabel}</Badge></div>}
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Type</span><Badge variant={selectedAd.adType === "sell" ? "secondary" : "outline"} className="capitalize">{selectedAd.adType}</Badge></div>
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Asset</span><span className="font-medium">{selectedAd.crypto} / {selectedAd.fiatCurrency}</span></div>
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Price</span><span className="font-medium">{selectedAd.rateType === 'fixed' ? `${selectedAd.fixedRate} ${selectedAd.fiatCurrency}` : `Market ${selectedAd.ratePercent}%`}</span></div>
                    <div className="flex justify-between items-center"><span className="text-muted-foreground">Limit</span><span className="font-medium">{selectedAd.minAmount} - {selectedAd.maxAmount} {selectedAd.fiatCurrency}</span></div>
                    <div className="flex justify-between items-start gap-4"><span className="text-muted-foreground">Payment Methods</span><div className="flex flex-wrap gap-1 justify-end">{selectedAd.paymentMethods.map(pm => <Badge key={pm} variant="outline">{pm}</Badge>)}</div></div>
                    {selectedAd.tags && selectedAd.tags.length > 0 && <div className="flex justify-between items-start gap-4"><span className="text-muted-foreground">Tags</span><div className="flex flex-wrap gap-1 justify-end">{selectedAd.tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}</div></div>}
                    <div className="space-y-1">
                        <span className="text-muted-foreground">Terms</span>
                        <p className="p-2 bg-muted rounded-md text-xs">{selectedAd.terms}</p>
                    </div>

                    <Separator />

                    <h4 className="font-medium text-base">Ad Statistics</h4>
                    {isStatsLoading && (
                        <div className="space-y-2">
                            <Skeleton className="h-4 w-full" />
                            <Skeleton className="h-4 w-3/4" />
                            <Skeleton className="h-4 w-full" />
                        </div>
                    )}
                    {!isStatsLoading && selectedAdStats && (
                        <div className="space-y-3 p-4 border rounded-md bg-secondary/50">
                            <div className="flex justify-between"><span>Total Trades Initiated:</span><span className="font-bold">{selectedAdStats.totalTrades}</span></div>
                            <div className="flex justify-between"><span>Completed:</span><span className="font-bold text-green-600">{selectedAdStats.completedTrades}</span></div>
                            <div className="flex justify-between"><span>Cancelled:</span><span className="font-bold text-muted-foreground">{selectedAdStats.cancelledTrades}</span></div>
                            <div className="flex justify-between"><span>Expired:</span><span className="font-bold text-amber-600">{selectedAdStats.expiredTrades}</span></div>
                            <div className="flex justify-between"><span>Disputed:</span><span className="font-bold text-red-600">{selectedAdStats.disputedTrades}</span></div>
                        </div>
                    )}
                     {!isStatsLoading && !selectedAdStats && (
                        <p className="text-muted-foreground text-center text-xs py-4">Could not load statistics.</p>
                     )}

                </div>
            )}
        </DialogContent>
      </Dialog>
    </>
  );
}
