'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import { Button } from '@/components/ui/button';
import { ChevronRight, ArrowUpRight, ArrowDownLeft, Timer } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '../ui/carousel';
import { Card, CardContent } from '../ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase } from '@/lib/supabase/client';
import { MiniCoinIcon } from '@/components/notifications/notification-bell';

interface DetailedActiveTrade {
  id: string;
  tradeId: string;
  adId?: string;
  buyerId: string;
  sellerId: string;
  crypto: string;
  amount: number;
  fiatCurrency: string;
  fiatAmount: number;
  price: number;
  paymentMethod: string;
  status: string;
  createdAt: string;
  expiresAtMs: number;
  isBuyer: boolean;
  counterpartyUsername: string;
  counterpartyAvatar: string | null;
}

export function ActiveTradesList() {
  const { user: authUser, isUserLoading } = useAuth();
  const [activeTrades, setActiveTrades] = useState<DetailedActiveTrade[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchActiveTrades = useCallback(async () => {
    const currentUserId = authUser?.uid || (authUser as any)?.id;
    if (!currentUserId) {
      setActiveTrades([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      let data: any[] | null = null;

      // 1. Fetch from secure server endpoint
      try {
        const res = await fetch('/api/trades?status=active,paid,disputed');
        if (res.ok) {
          const json = await res.json();
          if (json && Array.isArray(json.trades)) {
            data = json.trades;
          }
        }
      } catch (apiErr) {
        // fallback
      }

      // 2. Client-side fallback if API not available
      if (!data) {
        const { data: clientData, error } = await supabase
          .from('trades')
          .select('*')
          .or(`buyer_id.eq.${currentUserId},seller_id.eq.${currentUserId}`)
          .order('created_at', { ascending: false });

        if (!error && clientData) {
          data = clientData;
        }
      }

      if (!data || data.length === 0) {
        setActiveTrades([]);
        setIsLoading(false);
        return;
      }

      // 3. Fetch counterparty profiles for avatars and usernames
      const partnerIds = Array.from(
        new Set(
          data
            .flatMap((t: any) => [t.buyer_id, t.seller_id])
            .filter((id: any) => id && id !== currentUserId)
        )
      );

      let profileMap: Record<string, any> = {};
      if (partnerIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, username, display_name, avatar_url, photo_url')
          .in('id', partnerIds);

        if (profiles) {
          profiles.forEach((p: any) => {
            profileMap[p.id] = {
              username: p.username || p.display_name || 'Trader',
              avatar_url: p.avatar_url || p.photo_url || `/api/media/avatar/${p.id}`,
            };
          });
        }
      }

      const now = Date.now();
      const mapped: DetailedActiveTrade[] = [];

      for (const t of data) {
        const isBuyer = t.buyer_id === currentUserId;
        const partnerId = isBuyer ? t.seller_id : t.buyer_id;
        const counterparty = profileMap[partnerId];
        const rawStatus = (t.status || '').toLowerCase();
        const escrowStatus = (t.escrow_status || '').toLowerCase();

        // Calculate precise effective status
        const isDisputed = Boolean(
          t.is_disputed ||
          rawStatus === 'disputed' ||
          rawStatus === 'dispute' ||
          escrowStatus === 'disputed'
        );
        const isCompleted = Boolean(
          t.completed_at ||
          t.released_at ||
          rawStatus === 'completed' ||
          rawStatus === 'released' ||
          escrowStatus === 'completed' ||
          escrowStatus === 'released'
        );
        const isCancelled = Boolean(
          t.cancelled_at ||
          rawStatus === 'cancelled' ||
          rawStatus === 'canceled' ||
          escrowStatus === 'cancelled'
        );
        const isPaid = Boolean(
          t.paid_at ||
          t.marked_paid_at ||
          t.payment_confirmed_at ||
          rawStatus === 'paid' ||
          rawStatus === 'mark_paid' ||
          rawStatus === 'buyer_marked_paid' ||
          escrowStatus === 'paid'
        );
        const isExplicitExpired = Boolean(
          t.expired_at ||
          rawStatus === 'expired' ||
          escrowStatus === 'expired'
        );

        const createdAtMs = t.created_at ? new Date(t.created_at).getTime() : 0;
        const winMin = Number(t.payment_window_minutes || t.payment_window || 30);
        const expiresAtMs = t.expires_at ? new Date(t.expires_at).getTime() : (createdAtMs > 0 ? createdAtMs + winMin * 60 * 1000 : 0);
        const isTimeExpired = (!isPaid && !isCompleted && !isDisputed) && (expiresAtMs > 0 && now >= expiresAtMs);

        // Filter out non-active / finalized trades from the active banner
        if (isCompleted || isCancelled || isExplicitExpired || isTimeExpired) {
          continue;
        }

        let effectiveStatus = 'active';
        if (isDisputed) effectiveStatus = 'disputed';
        else if (isPaid) effectiveStatus = 'paid';

        const paymentMethod = t.payment_method || t.paymentMethod || 'Bank Transfer';
        const rawCoin = t.crypto || t.crypto_currency || t.asset_symbol || 'USDT';
        const coin = rawCoin.toUpperCase();
        const rawTradeId = t.trade_id || t.id;
        const shortTradeId = '#' + (rawTradeId || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 8).toUpperCase();

        mapped.push({
          id: t.id,
          tradeId: shortTradeId,
          adId: t.ad_id,
          buyerId: t.buyer_id,
          sellerId: t.seller_id,
          crypto: coin,
          amount: Number(t.crypto_amount || t.amount || 0),
          fiatCurrency: (t.fiat_currency || t.fiat || 'USD').toUpperCase(),
          fiatAmount: Number(t.fiat_amount || t.fiatAmount || 0),
          price: Number(t.price || 0),
          paymentMethod,
          status: effectiveStatus,
          createdAt: t.created_at,
          expiresAtMs,
          isBuyer,
          counterpartyUsername: counterparty?.username || (isBuyer ? t.seller_username : t.buyer_username) || 'Trader',
          counterpartyAvatar: counterparty?.avatar_url || null,
        });
      }

      setActiveTrades(mapped);
    } catch (err) {
      console.error('Error fetching active trades:', err);
    } finally {
      setIsLoading(false);
    }
  }, [authUser?.uid, (authUser as any)?.id]);

  useEffect(() => {
    fetchActiveTrades();
  }, [fetchActiveTrades]);

  if (isUserLoading || isLoading || !authUser || !activeTrades || activeTrades.length === 0) {
    return null;
  }

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'paid':
        return 'bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30';
      case 'disputed':
        return 'bg-amber-600/20 text-amber-700 dark:text-amber-300 border-amber-600/40 animate-pulse';
      default:
        return 'bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/30';
    }
  };

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-2.5">
        <h2 className="text-base sm:text-lg font-bold text-foreground flex items-center gap-2">
          <span>Active Trades</span>
          <span className="text-xs font-mono font-bold px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400 border border-blue-500/30">
            {activeTrades.length}
          </span>
        </h2>
      </div>

      <Carousel
        opts={{
          align: 'start',
        }}
        className="w-full"
      >
        <CarouselContent className="-ml-3">
          {activeTrades.map((trade) => {
            return (
              <CarouselItem key={trade.id} className="md:basis-1/2 lg:basis-1/3 pl-3">
                <Card className="h-full bg-card border border-border/80 hover:border-primary/50 transition-all shadow-xs hover:shadow-md rounded-2xl overflow-hidden">
                  <CardContent className="p-4 flex flex-col justify-between h-full gap-3">
                    {/* Top Row: DP, Username, Role badge, Trade ID, Status */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Avatar className="h-9 w-9 rounded-full border border-border/80 shrink-0 overflow-hidden shadow-xs">
                          {trade.counterpartyAvatar && (
                            <AvatarImage src={trade.counterpartyAvatar} alt={trade.counterpartyUsername} />
                          )}
                          <AvatarFallback className="bg-primary/10 text-primary font-bold text-xs">
                            {trade.counterpartyUsername.substring(0, 2).toUpperCase()}
                          </AvatarFallback>
                        </Avatar>

                        <div className="min-w-0 flex flex-col">
                          <div className="flex items-center gap-1.5 truncate">
                            <span className={cn(
                              'text-[10px] font-bold px-1.5 py-0.2 rounded shrink-0',
                              trade.isBuyer
                                ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                                : 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                            )}>
                              {trade.isBuyer ? 'BUY' : 'SELL'}
                            </span>
                            <span className="font-bold text-xs text-foreground truncate">
                              @{trade.counterpartyUsername}
                            </span>
                          </div>
                          <span className="text-[10px] text-muted-foreground font-mono mt-0.5">
                            {trade.tradeId}
                          </span>
                        </div>
                      </div>

                      {/* Status Badge */}
                      <Badge
                        variant="outline"
                        className={cn('capitalize text-[11px] font-semibold px-2 py-0.5 rounded-full border shrink-0', getStatusBadgeClass(trade.status))}
                      >
                        {trade.status === 'paid' ? 'Marked Paid' : trade.status}
                      </Badge>
                    </div>

                    {/* Middle Section: Crypto Amount with Logo & Fiat Equivalent */}
                    <div className="flex items-center justify-between pt-2 border-t border-border/40">
                      <div className="flex items-center gap-1.5">
                        <MiniCoinIcon symbol={trade.crypto} className="h-4 w-4" />
                        <span className="font-bold text-sm text-foreground">
                          {trade.amount.toFixed(4)} {trade.crypto}
                        </span>
                      </div>
                      <span className="text-xs font-semibold text-muted-foreground font-mono">
                        ≈ {trade.fiatAmount.toLocaleString()} {trade.fiatCurrency}
                      </span>
                    </div>

                    {/* Bottom Row: Payment Method Pill and View Button */}
                    <div className="flex items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] font-medium px-2 py-0.5 bg-muted rounded-md text-foreground truncate max-w-[130px] border border-border/50">
                        {trade.paymentMethod}
                      </span>

                      <Button asChild variant="default" size="sm" className="h-7 text-xs px-2.5 rounded-lg shrink-0 gap-1 font-semibold cursor-pointer">
                        <Link href={`/trade/${trade.id}`}>
                          View <ChevronRight className="h-3.5 w-3.5" />
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </CarouselItem>
            );
          })}
        </CarouselContent>
        {activeTrades.length > 1 && <CarouselPrevious className="hidden sm:flex -left-3" />}
        {activeTrades.length > 1 && <CarouselNext className="hidden sm:flex -right-3" />}
      </Carousel>
    </div>
  );
}
