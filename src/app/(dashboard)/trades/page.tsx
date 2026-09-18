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
import { formatCompactUtc } from '@/lib/date-utils';

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

      // Extract all user IDs for batch profile lookup
      const allUserIds = Array.from(
        new Set(
          (data || [])
            .flatMap((raw: any) => [raw.buyer_id, raw.seller_id])
            .filter(Boolean)
        )
      );

      let profileMap: Record<string, any> = {};
      if (allUserIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, display_name, country, country_code, avatar_url, photo_url')
          .in('id', allUserIds);

        if (profiles) {
          profiles.forEach((p: any) => {
            profileMap[p.id] = {
              id: p.id,
              username: p.username || p.display_name || 'Trader',
              country: p.country || p.country_code || null,
              avatar_url: p.avatar_url || p.photo_url || null,
            };
          });
        }
      }

      const mapped: Trade[] = (data || []).map((raw: any) => {
        const rawStatus = (raw.status || '').toLowerCase();
        const escrowStatus = (raw.escrow_status || '').toLowerCase();

        // Calculate precise effective status
        let effectiveStatus = 'active';

        if (
          raw.is_disputed ||
          rawStatus === 'disputed' ||
          rawStatus === 'dispute' ||
          escrowStatus === 'disputed'
        ) {
          effectiveStatus = 'disputed';
        } else if (
          rawStatus === 'released' ||
          rawStatus === 'completed' ||
          escrowStatus === 'released' ||
          escrowStatus === 'completed' ||
          Boolean(raw.released_at) ||
          Boolean(raw.completed_at)
        ) {
          effectiveStatus = 'completed';
        } else if (
          rawStatus === 'cancelled' ||
          rawStatus === 'canceled' ||
          escrowStatus === 'cancelled' ||
          Boolean(raw.cancelled_at)
        ) {
          effectiveStatus = 'cancelled';
        } else if (
          rawStatus === 'paid' ||
          rawStatus === 'mark_paid' ||
          rawStatus === 'buyer_marked_paid' ||
          rawStatus === 'payment_sent' ||
          escrowStatus === 'paid' ||
          Boolean(raw.paid_at) ||
          Boolean(raw.marked_paid_at) ||
          Boolean(raw.payment_confirmed_at)
        ) {
          effectiveStatus = 'paid';
        } else if (
          rawStatus === 'expired' ||
          escrowStatus === 'expired' ||
          Boolean(raw.expired_at)
        ) {
          effectiveStatus = 'expired';
        } else {
          // Check payment window timer
          const createdAtMs = raw.created_at ? new Date(raw.created_at).getTime() : 0;
          const winMin = Number(raw.payment_window_minutes || raw.payment_window || 30);
          const expiresAtMs = raw.expires_at
            ? new Date(raw.expires_at).getTime()
            : (createdAtMs > 0 ? createdAtMs + winMin * 60 * 1000 : 0);

          if (expiresAtMs > 0 && Date.now() > expiresAtMs) {
            effectiveStatus = 'expired';
          } else {
            effectiveStatus = 'active';
          }
        }

        return {
          id: raw.id,
          tradeId: raw.trade_id || raw.id,
          adId: raw.ad_id,
          buyerId: raw.buyer_id,
          sellerId: raw.seller_id,
          crypto: (raw.crypto || raw.asset_symbol || 'USDT').toUpperCase(),
          amount: Number(raw.amount ?? raw.crypto_amount ?? 0),
          fiatCurrency: (raw.fiat_currency || raw.fiat || 'USD').toUpperCase(),
          fiatAmount: Number(raw.fiat_amount || 0),
          fiatAmountInUSD: Number(raw.fiat_amount_in_usd || 0),
          price: Number(raw.price || 0),
          status: effectiveStatus as any,
          paymentMethod: raw.payment_method || '',
          escrowFee: Number(raw.escrow_fee || 0),
          createdAt: raw.created_at,
          expiresAt: raw.expires_at,
          paidAt: raw.paid_at,
          releasedAt: raw.released_at,
          claimedByBuyer: raw.claimed_by_buyer ?? false,
          buyer: profileMap[raw.buyer_id] || { id: raw.buyer_id, username: raw.buyer_username || 'Buyer' },
          seller: profileMap[raw.seller_id] || { id: raw.seller_id, username: raw.seller_username || 'Seller' },
        };
      });

      setAllTrades(mapped);
    } catch (err) {
      console.error('Error fetching trades:', err);
    } finally {
      setIsLoadingTrades(false);
    }
  }, [authUser?.uid]);

  useEffect(() => {
    fetchTrades();

    // Listen to live insert and status changes on trades
    const tradeChannel = supabase
      .channel('trade-status-updates')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'trades',
        },
        () => {
          fetchTrades();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(tradeChannel);
    };
  }, [fetchTrades]);

  const handleDownloadCSV = async () => {
    try {
      // 1. Trades section
      let csvContent = '=== TRADES HISTORY ===\n';
      csvContent += 'Trade ID,Type,Buyer Username,Seller Username,Crypto Asset,Coin Amount,Fiat Amount,Fiat Currency,Escrow Fee,Status,Date (UTC),Time (UTC)\n';
      
      allTrades.forEach((t) => {
        const d = t.createdAt ? new Date(t.createdAt) : null;
        const dateStr = d ? d.toISOString().split('T')[0] : 'N/A';
        const timeStr = d ? d.toISOString().split('T')[1].replace('Z', '') : 'N/A';
        const tradeId = `"${(t.tradeId || t.id || '').replace(/"/g, '""')}"`;
        const role = t.buyerId === authUser?.id ? 'BUY' : 'SELL';
        const buyer = `"${(t.buyer?.username || t.buyerId || 'N/A').replace(/"/g, '""')}"`;
        const seller = `"${(t.seller?.username || t.sellerId || 'N/A').replace(/"/g, '""')}"`;
        const crypto = t.crypto || 'BTC';
        const coinAmount = t.amount || 0;
        const fiatAmount = t.fiatAmount || 0;
        const fiatCurrency = t.fiatCurrency || 'USD';
        const escrowFee = t.escrowFee || 0;
        const status = t.status || 'unknown';

        csvContent += `${tradeId},${role},${buyer},${seller},${crypto},${coinAmount},${fiatAmount},${fiatCurrency},${escrowFee},${status},"${dateStr}","${timeStr}"\n`;
      });

      // 2. Fetch Deposits
      if (authUser?.id) {
        try {
          const { data: deposits } = await supabase
            .from('deposits')
            .select('*')
            .eq('user_id', authUser.id)
            .order('created_at', { ascending: false });

          if (deposits && deposits.length > 0) {
            csvContent += '\n=== DEPOSITS HISTORY ===\n';
            csvContent += 'Deposit ID,Asset,Amount,Network,Transaction Hash,Status,Date (UTC),Time (UTC)\n';
            deposits.forEach((dep: any) => {
              const d = dep.created_at ? new Date(dep.created_at) : null;
              const dateStr = d ? d.toISOString().split('T')[0] : 'N/A';
              const timeStr = d ? d.toISOString().split('T')[1].replace('Z', '') : 'N/A';
              const depId = `"${(dep.id || '').replace(/"/g, '""')}"`;
              const asset = dep.asset_symbol || dep.asset || dep.crypto || 'USDT';
              const amount = dep.amount || 0;
              const network = dep.network || 'Mainnet';
              const txHash = `"${(dep.tx_hash || dep.transaction_hash || dep.txid || 'N/A').replace(/"/g, '""')}"`;
              const status = dep.status || 'COMPLETED';

              csvContent += `${depId},${asset},${amount},${network},${txHash},${status},"${dateStr}","${timeStr}"\n`;
            });
          }
        } catch (depErr) {
          console.warn('CSV export deposits fetch notice:', depErr);
        }

        // 3. Fetch Withdrawals
        try {
          const { data: withdrawals } = await supabase
            .from('withdrawals')
            .select('*')
            .eq('user_id', authUser.id)
            .order('created_at', { ascending: false });

          if (withdrawals && withdrawals.length > 0) {
            csvContent += '\n=== WITHDRAWALS HISTORY ===\n';
            csvContent += 'Withdrawal ID,Asset,Amount,Network Fee,Destination Address,Transaction Hash,Status,Date (UTC),Time (UTC)\n';
            withdrawals.forEach((w: any) => {
              const d = w.created_at ? new Date(w.created_at) : null;
              const dateStr = d ? d.toISOString().split('T')[0] : 'N/A';
              const timeStr = d ? d.toISOString().split('T')[1].replace('Z', '') : 'N/A';
              const wId = `"${(w.id || '').replace(/"/g, '""')}"`;
              const asset = w.asset_symbol || w.asset || w.crypto || 'USDT';
              const amount = w.amount || 0;
              const fee = w.fee || w.network_fee || 0;
              const destAddr = `"${(w.destination_address || w.address || 'N/A').replace(/"/g, '""')}"`;
              const txHash = `"${(w.tx_hash || w.transaction_hash || w.txid || 'N/A').replace(/"/g, '""')}"`;
              const status = w.status || 'COMPLETED';

              csvContent += `${wId},${asset},${amount},${fee},${destAddr},${txHash},${status},"${dateStr}","${timeStr}"\n`;
            });
          }
        } catch (wErr) {
          console.warn('CSV export withdrawals fetch notice:', wErr);
        }
      }

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `paxones_activity_history_${Date.now()}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (csvError) {
      console.error('Failed to generate CSV export:', csvError);
    }
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
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {trade.createdAt ? formatCompactUtc(trade.createdAt) : 'N/A'}
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
