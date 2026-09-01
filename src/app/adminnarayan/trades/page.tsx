'use client';

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
import { Badge } from '@/components/ui/badge';
import type { Trade } from '@/lib/types';
import { cn, toDate } from '@/lib/utils';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Skeleton } from '@/components/ui/skeleton';
import { useState, useEffect, useMemo } from 'react';
import { Input } from '@/components/ui/input';
import { Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { statusColors } from '@/lib/status-colors';
import { supabase } from '@/lib/supabase/client';

export default function AdminTradesPage() {
  const router = useRouter();
  const { isAdmin, isLoading: isAdminLoading } = useAdminStatus();
  const [trades, setTrades] = useState<Trade[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (isAdminLoading) {
      setIsLoading(true);
      return;
    }
    if (!isAdmin) {
      setIsLoading(false);
      return;
    }

    const fetchTrades = async () => {
      setIsLoading(true);
      try {
        const { data, error } = await supabase
          .from('trades')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;

        const mapped: Trade[] = (data || []).map((t: any) => ({
          id: t.id,
          tradeId: t.trade_id || t.id,
          buyerId: t.buyer_id,
          sellerId: t.seller_id,
          adId: t.ad_id,
          fiatAmount: Number(t.fiat_amount || 0),
          fiatCurrency: t.fiat_currency || 'USD',
          crypto: t.crypto || 'USDT',
          amount: Number(t.amount || 0),
          price: Number(t.price || 0),
          status: t.status || 'created',
          createdAt: t.created_at || new Date().toISOString(),
          paymentMethod: t.payment_method || 'Bank Transfer',
          buyer: {
            id: t.buyer_id,
            username: t.buyer_username || 'Buyer',
            feedbackScore: 100,
            completedTrades: 0,
          },
          seller: {
            id: t.seller_id,
            username: t.seller_username || 'Seller',
            feedbackScore: 100,
            completedTrades: 0,
          },
        }));

        setTrades(mapped);
      } catch (error) {
        console.error('Error fetching trades:', error);
        setTrades([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTrades();
  }, [isAdmin, isAdminLoading]);

  const filteredTrades = useMemo(() => {
    if (!trades) return null;
    if (!searchTerm.trim()) return trades;
    const lower = searchTerm.toLowerCase();
    return trades.filter(
      (t) =>
        t.tradeId.toLowerCase().includes(lower) ||
        t.buyer.username.toLowerCase().includes(lower) ||
        t.seller.username.toLowerCase().includes(lower) ||
        t.crypto.toLowerCase().includes(lower)
    );
  }, [trades, searchTerm]);

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold md:text-2xl">Trade History</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>All Trades</CardTitle>
          <CardDescription>A log of all trades that have occurred on the platform.</CardDescription>
          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search by Trade ID, buyer, seller, or asset..."
              className="pl-10"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Trade ID</TableHead>
                <TableHead>Buyer</TableHead>
                <TableHead>Seller</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center">
                    <Skeleton className="h-4 w-1/4 mx-auto" />
                  </TableCell>
                </TableRow>
              )}
              {!isLoading &&
                filteredTrades?.map((trade) => (
                  <TableRow
                    key={trade.id}
                    onClick={() => router.push(`/trade/${trade.id}`)}
                    className="cursor-pointer"
                  >
                    <TableCell className="font-mono text-xs">{trade.tradeId}</TableCell>
                    <TableCell>{trade.buyer.username}</TableCell>
                    <TableCell>{trade.seller.username}</TableCell>
                    <TableCell>
                      {trade.amount.toFixed(6)} {trade.crypto}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={cn('capitalize', statusColors[trade.status])}>
                        {trade.status}
                      </Badge>
                    </TableCell>
                    <TableCell>{toDate(trade.createdAt)?.toLocaleDateString() ?? 'N/A'}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" asChild onClick={(e) => e.stopPropagation()}>
                        <Link href={`/trade/${trade.id}`}>View</Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  );
}
