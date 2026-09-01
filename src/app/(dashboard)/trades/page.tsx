'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import type { User, Trade } from '@/lib/types';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import Link from 'next/link';
import { DollarSign, CheckCircle, ArrowLeftRight, Download, Loader2, ThumbsUp, ThumbsDown } from 'lucide-react';
import { cn, toDate } from '@/lib/utils';
import { statusColors } from '@/lib/status-colors';
import { useRouter } from 'next/navigation';
import { FlagIcon } from '@/components/ui/flag-icon';
import { supabase } from '@/lib/supabase/client';

function DashboardCardSkeleton() {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <Skeleton className="h-4 w-24" />
      </CardHeader>
      <CardContent>
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-3 w-20 mt-2" />
      </CardContent>
    </Card>
  );
}

export default function MyTradesPage() {
  const { user: authUser, profile, isUserLoading: isAuthLoading } = useAuth();
  const router = useRouter();

  const [allTrades, setAllTrades] = useState<Trade[]>([]);
  const [isLoadingTrades, setIsLoadingTrades] = useState(true);

  useEffect(() => {
    if (!isAuthLoading && !authUser) {
      router.push('/login');
    }
  }, [authUser, isAuthLoading, router]);

  const fetchTrades = useCallback(async () => {
    if (!authUser?.uid) return;
    setIsLoadingTrades(true);
    try {
      const { data, error } = await supabase
        .from('trades')
        .select('*')
        .or(`buyer_id.eq.${authUser.uid},seller_id.eq.${authUser.uid}`)
        .order('created_at', { ascending: false });

      if (error) throw error;

      const mapped: Trade[] = (data || []).map((raw: any) => ({
        id: raw.id,
        tradeId: raw.trade_id || raw.id,
        adId: raw.ad_id,
        buyerId: raw.buyer_id,
        sellerId: raw.seller_id,
        crypto: raw.crypto,
        amount: Number(raw.amount || 0),
        fiatCurrency: raw.fiat_currency,
        fiatAmount: Number(raw.fiat_amount || 0),
        fiatAmountInUSD: Number(raw.fiat_amount_in_usd || 0),
        price: Number(raw.price || 0),
        status: raw.status || 'active',
        paymentMethod: raw.payment_method || '',
        escrowFee: Number(raw.escrow_fee || 0),
        createdAt: raw.created_at,
        expiresAt: raw.expires_at,
        paidAt: raw.paid_at,
        releasedAt: raw.released_at,
        claimedByBuyer: raw.claimed_by_buyer ?? false,
        buyer: raw.buyer || { id: raw.buyer_id, username: raw.buyer_username || 'Buyer' },
        seller: raw.seller || { id: raw.seller_id, username: raw.seller_username || 'Seller' },
      }));

      setAllTrades(mapped);
    } catch (err) {
      console.error('Error fetching trades:', err);
    } finally {
      setIsLoadingTrades(false);
    }
  }, [authUser?.uid]);

  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);

  const handleDownloadCSV = () => {
    if (!allTrades.length) return;
    const headers = 'Crypto,Amount,Date (GMT),Buyer,Seller,Status\n';
    const csvContent = allTrades
      .map((t) => {
        const date = toDate(t.createdAt)?.toUTCString() ?? 'N/A';
        return `${t.crypto},${t.amount},"${date}",${t.buyer?.username || 'N/A'},${t.seller?.username || 'N/A'},${t.status}`;
      })
      .join('\n');

    const blob = new Blob([headers + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', 'trade_history.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (isAuthLoading || (!authUser && typeof window !== 'undefined')) {
    return (
      <div className="flex flex-1 items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!authUser) {
    return null;
  }

  const user = profile;

  return (
    <>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-lg font-semibold md:text-2xl">My Trades & Statistics</h1>
        <Button onClick={handleDownloadCSV} variant="outline" disabled={!allTrades.length}>
          <Download className="mr-2 h-4 w-4" />
          Download CSV
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 md:gap-8 lg:grid-cols-3 mb-8">
        {isAuthLoading ? (
          <DashboardCardSkeleton />
        ) : (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Volume</CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">${(user?.tradeVolume || 0).toLocaleString()}</div>
            </CardContent>
          </Card>
        )}
        {isAuthLoading ? (
          <DashboardCardSkeleton />
        ) : (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Completed Trades</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{user?.completedTrades || 0}</div>
            </CardContent>
          </Card>
        )}
        {isAuthLoading ? (
          <DashboardCardSkeleton />
        ) : (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Feedback</CardTitle>
              <div className="flex gap-1 text-muted-foreground">
                <ThumbsUp className="h-4 w-4" />
                <ThumbsDown className="h-4 w-4" />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold flex items-center gap-2">
                <span className="text-green-600">{user?.positiveFeedback || 0}</span>
                <span>/</span>
                <span className="text-red-600">{user?.negativeFeedback || 0}</span>
              </div>
              <p className="text-xs text-muted-foreground">Positive / Negative</p>
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Trade History</CardTitle>
          <CardDescription>A log of all your past and active trades.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trade ID</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Partner</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingTrades && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center">
                    Loading trades...
                  </TableCell>
                </TableRow>
              )}
              {!isLoadingTrades &&
                allTrades.map((trade) => {
                  const isBuyer = trade.buyerId === authUser?.uid;
                  const partner = isBuyer ? trade.seller : trade.buyer;
                  return (
                    <TableRow key={trade.id}>
                      <TableCell className="font-mono text-xs">{trade.tradeId}</TableCell>
                      <TableCell>
                        <Badge variant={isBuyer ? 'default' : 'secondary'}>{isBuyer ? 'Buyer' : 'Seller'}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {partner?.username}
                          {partner?.country && <FlagIcon countryCode={partner.country} />}
                        </div>
                      </TableCell>
                      <TableCell>
                        {trade.amount.toFixed(6)} {trade.crypto}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn('capitalize', statusColors[trade.status])}>
                          {trade.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {toDate(trade.createdAt)?.toLocaleString('default', {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        }) ?? 'N/A'}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button variant="outline" size="sm" asChild>
                          <Link href={`/trade/${trade.id}`}>
                            <ArrowLeftRight className="mr-2 h-3 w-3" />
                            View
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              {!isLoadingTrades && !allTrades.length && (
                <TableRow>
                  <TableCell colSpan={7} className="h-24 text-center">
                    You have no trades yet.
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
