'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/providers/auth-provider';
import type { Trade } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '../ui/badge';
import { statusColors } from '@/lib/status-colors';
import { cn } from '@/lib/utils';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '../ui/carousel';
import { Card, CardContent } from '../ui/card';
import { supabase } from '@/lib/supabase/client';

export function ActiveTradesList() {
  const { user: authUser, isUserLoading } = useAuth();
  const [activeTrades, setActiveTrades] = useState<Trade[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchActiveTrades = useCallback(async () => {
    if (!authUser?.uid) {
      setActiveTrades([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('trades')
        .select('*')
        .or(`buyer_id.eq.${authUser.uid},seller_id.eq.${authUser.uid}`)
        .in('status', ['active', 'paid', 'disputed'])
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
        price: Number(raw.price || 0),
        status: raw.status || 'active',
        createdAt: raw.created_at,
        buyer: raw.buyer || { id: raw.buyer_id, username: raw.buyer_username || 'Buyer' },
        seller: raw.seller || { id: raw.seller_id, username: raw.seller_username || 'Seller' },
      }));

      setActiveTrades(mapped);
    } catch (err) {
      console.error('Error fetching active trades:', err);
    } finally {
      setIsLoading(false);
    }
  }, [authUser?.uid]);

  useEffect(() => {
    fetchActiveTrades();
  }, [fetchActiveTrades]);

  if (isUserLoading || isLoading || !authUser || !activeTrades || activeTrades.length === 0) {
    return null;
  }

  return (
    <div className="mb-6">
      <h2 className="text-lg font-semibold mb-2 text-foreground">Active Trades ({activeTrades.length})</h2>
      <Carousel
        opts={{
          align: 'start',
        }}
        className="w-full"
      >
        <CarouselContent className="-ml-2">
          {activeTrades.map((trade) => {
            const isBuyer = trade.buyerId === authUser?.uid;
            const partner = isBuyer ? trade.seller : trade.buyer;
            return (
              <CarouselItem key={trade.id} className="md:basis-1/2 lg:basis-1/3 pl-2">
                <Card className="h-full bg-secondary">
                  <CardContent className="p-4 flex items-center justify-between gap-4">
                    <div className="flex-grow overflow-hidden">
                      <p className="text-xs text-muted-foreground">
                        Trade with <span className="font-semibold text-foreground">{partner?.username || 'Trader'}</span>
                      </p>
                      <p className="font-semibold truncate">
                        {trade.amount.toFixed(6)} {trade.crypto}
                      </p>
                      <Badge variant="outline" className={cn('capitalize mt-1', statusColors[trade.status])}>
                        {trade.status}
                      </Badge>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/trade/${trade.id}`}>
                        View <ChevronRight className="h-4 w-4" />
                      </Link>
                    </Button>
                  </CardContent>
                </Card>
              </CarouselItem>
            );
          })}
        </CarouselContent>
        {activeTrades.length > 1 && <CarouselPrevious className="hidden sm:flex" />}
        {activeTrades.length > 1 && <CarouselNext className="hidden sm:flex" />}
      </Carousel>
    </div>
  );
}
