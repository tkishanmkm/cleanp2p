'use client';

import { useState, useEffect, useMemo } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MoreHorizontal, ShieldCheck, Search } from 'lucide-react';
import type { Dispute, Trade } from '@/lib/types';
import { useToast } from '@/hooks/use-toast';
import { resolveDispute } from '@/lib/admin';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { cn, toDate } from '@/lib/utils';
import Link from 'next/link';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Input } from '@/components/ui/input';
import { useRouter } from 'next/navigation';
import { usePrices } from '@/context/price-context';
import { useAuth } from '@/components/providers/auth-provider';
import { supabase } from '@/lib/supabase/client';

const statusColors: Record<Dispute['status'], string> = {
  open: 'border-red-500/50 text-red-600 bg-red-50',
  resolved: 'border-green-500/50 text-green-600 bg-green-50',
  cancelled: 'border-gray-500/50 text-gray-600 bg-gray-50',
};

export default function AdminDisputesPage() {
  const { user: adminUser } = useAuth();
  const { toast } = useToast();
  const router = useRouter();
  const { isAdmin, isLoading: isAdminLoading } = useAdminStatus();
  const [showAll, setShowAll] = useState(false);
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);
  const [awardTo, setAwardTo] = useState<'buyer' | 'seller' | null>(null);
  const [isResolveAlertOpen, setIsResolveAlertOpen] = useState(false);
  const [disputes, setDisputes] = useState<Dispute[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const { fiatRates } = usePrices();

  useEffect(() => {
    if (isAdminLoading) return;
    if (!isAdmin) {
      setIsLoading(false);
      return;
    }

    const fetchDisputes = async () => {
      setIsLoading(true);
      try {
        let query = supabase.from('disputes').select('*');
        if (!showAll) {
          query = query.eq('status', 'open');
        }
        const { data, error } = await query.order('created_at', { ascending: false });

        if (error) throw error;

        const disputesData: Dispute[] = (data || []).map((doc: any) => ({
          id: doc.id,
          tradeId: doc.trade_id || doc.tradeId,
          openedBy: doc.opened_by || doc.openedBy || 'User',
          reason: doc.reason || '',
          status: doc.status || 'open',
          createdAt: doc.created_at || doc.createdAt || new Date().toISOString(),
          resolvedAt: doc.resolved_at || doc.resolvedAt,
          resolvedBy: doc.resolved_by || doc.resolvedBy,
          winnerId: doc.winner_id || doc.winnerId,
        }));

        setDisputes(disputesData);
      } catch (error) {
        console.error('Error fetching disputes:', error);
        toast({ variant: 'destructive', title: 'Error', description: 'Could not fetch disputes.' });
      } finally {
        setIsLoading(false);
      }
    };

    fetchDisputes();
  }, [isAdmin, isAdminLoading, showAll, toast]);

  const filteredDisputes = useMemo(() => {
    if (!disputes) return null;
    if (!searchTerm.trim()) return disputes;
    const lower = searchTerm.toLowerCase();
    return disputes.filter((d) => {
      const tradeIdMatch = d.tradeId?.toLowerCase().includes(lower);
      const openedByMatch = d.openedBy?.toLowerCase().includes(lower);
      const reasonMatch = d.reason?.toLowerCase().includes(lower);
      return tradeIdMatch || openedByMatch || reasonMatch;
    });
  }, [disputes, searchTerm]);

  const handleResolve = async () => {
    if (!selectedDispute || !awardTo || !adminUser) return;

    try {
      const { data: tradeData, error: tradeErr } = await supabase
        .from('trades')
        .select('*')
        .eq('id', selectedDispute.tradeId)
        .maybeSingle();

      if (tradeErr || !tradeData) {
        toast({
          variant: 'destructive',
          title: 'Resolution Failed',
          description: 'Trade record could not be found.',
        });
        return;
      }

      const trade: Trade = {
        id: tradeData.id,
        tradeId: tradeData.trade_id || tradeData.id,
        buyerId: tradeData.buyer_id,
        sellerId: tradeData.seller_id,
        adId: tradeData.ad_id,
        fiatAmount: Number(tradeData.fiat_amount || 0),
        fiatCurrency: tradeData.fiat_currency || 'USD',
        crypto: tradeData.crypto || 'USDT',
        amount: Number(tradeData.amount || 0),
        price: Number(tradeData.price || 0),
        status: tradeData.status || 'disputed',
        createdAt: tradeData.created_at || new Date().toISOString(),
        paymentMethod: tradeData.payment_method || 'Bank Transfer',
        buyerUsername: tradeData.buyer_username || 'Buyer',
        sellerUsername: tradeData.seller_username || 'Seller',
      };

      let fiatAmountInUSD = trade.fiatAmountInUSD;
      if (fiatAmountInUSD === undefined || fiatAmountInUSD === null || isNaN(fiatAmountInUSD)) {
        const exchangeRate = fiatRates[trade.fiatCurrency] || 1;
        fiatAmountInUSD = trade.fiatAmount / exchangeRate;
      }

      const winnerId = awardTo === 'buyer' ? trade.buyerId : trade.sellerId;

      await resolveDispute(null, trade, selectedDispute, winnerId, adminUser.uid, fiatAmountInUSD);
      toast({ title: 'Dispute Resolved', description: `Trade awarded to the ${awardTo}.` });
      if (!showAll) {
        setDisputes((currentDisputes) => currentDisputes?.filter((d) => d.id !== selectedDispute.id) || null);
      } else {
        setDisputes(
          (currentDisputes) =>
            currentDisputes?.map((d) => (d.id === selectedDispute.id ? { ...d, status: 'resolved' } : d)) || null
        );
      }
    } catch (e: any) {
      toast({ variant: 'destructive', title: 'Resolution Failed', description: e.message });
    }
    setIsResolveAlertOpen(false);
    setSelectedDispute(null);
    setAwardTo(null);
  };

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">Dispute Center</h1>
        <Button variant="outline" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show Open Only' : 'Show All'}
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Manage Disputes</CardTitle>
          <CardDescription>Review and resolve trade disputes between users.</CardDescription>
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by Trade ID, user, or reason..."
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
                  <TableHead>Trade ID</TableHead>
                  <TableHead>Opened By</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6}>Loading disputes...</TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  filteredDisputes?.map((dispute) => (
                    <TableRow
                      key={dispute.id}
                      onClick={() => router.push(`/trade/${dispute.tradeId}`)}
                      className="cursor-pointer"
                    >
                      <TableCell>
                        <Button variant="link" asChild className="p-0" onClick={(e) => e.stopPropagation()}>
                          <Link href={`/trade/${dispute.tradeId}`} target="_blank">
                            {dispute.tradeId.substring(0, 8)}...
                          </Link>
                        </Button>
                      </TableCell>
                      <TableCell className="font-medium">{dispute.openedBy}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{dispute.reason}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('capitalize', statusColors[dispute.status])}>
                          {dispute.status}
                        </Badge>
                      </TableCell>
                      <TableCell>{toDate(dispute.createdAt)?.toLocaleString() ?? 'N/A'}</TableCell>
                      <TableCell className="text-right">
                        {dispute.status === 'open' && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                aria-haspopup="true"
                                size="icon"
                                variant="ghost"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <MoreHorizontal className="h-4 w-4" />
                                <span className="sr-only">Toggle menu</span>
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end">
                              <DropdownMenuLabel>Resolve</DropdownMenuLabel>
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedDispute(dispute);
                                  setAwardTo('buyer');
                                  setIsResolveAlertOpen(true);
                                }}
                              >
                                Award to Buyer
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedDispute(dispute);
                                  setAwardTo('seller');
                                  setIsResolveAlertOpen(true);
                                }}
                              >
                                Award to Seller
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                {!isLoading && !filteredDisputes?.length && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center h-24">
                      No disputes found.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          <div className="grid gap-4 md:hidden">
            {isLoading && <p className="text-center text-sm text-muted-foreground py-4">Loading disputes...</p>}
            {!isLoading &&
              filteredDisputes?.map((dispute) => (
                <Card key={dispute.id} onClick={() => router.push(`/trade/${dispute.tradeId}`)}>
                  <CardHeader>
                    <div className="flex justify-between items-start">
                      <CardTitle className="text-base font-mono">{dispute.tradeId.substring(0, 12)}...</CardTitle>
                      <Badge variant="outline" className={cn('capitalize', statusColors[dispute.status])}>
                        {dispute.status}
                      </Badge>
                    </div>
                    <CardDescription>Opened by: {dispute.openedBy}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground line-clamp-2">{dispute.reason}</p>
                  </CardContent>
                  {dispute.status === 'open' && (
                    <CardFooter className="gap-2">
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDispute(dispute);
                          setAwardTo('buyer');
                          setIsResolveAlertOpen(true);
                        }}
                      >
                        Award to Buyer
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedDispute(dispute);
                          setAwardTo('seller');
                          setIsResolveAlertOpen(true);
                        }}
                      >
                        Award to Seller
                      </Button>
                    </CardFooter>
                  )}
                </Card>
              ))}
            {!isLoading && !filteredDisputes?.length && (
              <p className="text-center text-sm text-muted-foreground py-8">No disputes found.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <AlertDialog open={isResolveAlertOpen} onOpenChange={setIsResolveAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Resolve Dispute?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to award the trade to the <span className="font-bold">{awardTo}</span>. This will transfer
              the escrowed crypto and cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                setAwardTo(null);
                setSelectedDispute(null);
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={handleResolve}>
              <ShieldCheck className="mr-2 h-4 w-4" />
              Confirm & Resolve
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
