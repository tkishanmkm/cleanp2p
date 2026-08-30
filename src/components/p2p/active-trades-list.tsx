
'use client';

import { useFirebase, useCollection, useMemoFirebase } from '@/firebase';
import { collection, query, where } from 'firebase/firestore';
import { useMemo } from 'react';
import type { Trade } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { Badge } from '../ui/badge';
import { statusColors } from '@/lib/status-colors';
import { cn } from '@/lib/utils';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from '../ui/carousel';
import { Card, CardContent } from '../ui/card';

export function ActiveTradesList() {
    const { firestore, user: authUser, isUserLoading } = useFirebase();

    const activeTradesAsBuyerQuery = useMemoFirebase(() => 
        authUser 
            ? query(collection(firestore, 'trades'), where('buyerId', '==', authUser.uid), where('status', 'in', ['active', 'paid'])) 
            : null, 
        [firestore, authUser]
    );
    const { data: activeBuyerTrades, isLoading: activeBuyerTradesLoading } = useCollection<Trade>(activeTradesAsBuyerQuery);

    const activeTradesAsSellerQuery = useMemoFirebase(() => 
        authUser 
            ? query(collection(firestore, 'trades'), where('sellerId', '==', authUser.uid), where('status', 'in', ['active', 'paid'])) 
            : null, 
        [firestore, authUser]
    );
    const { data: activeSellerTrades, isLoading: activeSellerTradesLoading } = useCollection<Trade>(activeTradesAsSellerQuery);

    const isLoading = isUserLoading || activeBuyerTradesLoading || activeSellerTradesLoading;

    const activeTrades = useMemo(() => {
        if (!activeBuyerTrades && !activeSellerTrades) return [];
        const combined = [...(activeBuyerTrades || []), ...(activeSellerTrades || [])];
        return Array.from(new Map(combined.map(trade => [trade.id, trade])).values());
    }, [activeBuyerTrades, activeSellerTrades]);

    if (isLoading || !authUser || !activeTrades || activeTrades.length === 0) {
        return null; // Don't render anything if not logged in, no active trades or still loading
    }
    
    return (
        <div className="mb-6">
            <h2 className="text-lg font-semibold mb-2 text-foreground">Active Trades ({activeTrades.length})</h2>
             <Carousel
                opts={{
                align: "start",
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
                                        Trade with <span className="font-semibold text-foreground">{partner.username}</span>
                                    </p>
                                    <p className="font-semibold truncate">{trade.amount.toFixed(6)} {trade.crypto}</p>
                                    <Badge variant="outline" className={cn("capitalize mt-1", statusColors[trade.status])}>
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
                         )
                    })}
                </CarouselContent>
                {activeTrades.length > 1 && <CarouselPrevious className="hidden sm:flex" />}
                {activeTrades.length > 1 && <CarouselNext className="hidden sm:flex" />}
            </Carousel>
        </div>
    );
}
