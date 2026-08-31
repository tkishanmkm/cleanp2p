
'use client';

import React, { Suspense, useMemo, useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useAuth } from '@/components/providers/auth-provider';
import { useFirebase, useDoc, useMemoFirebase } from '@/firebase';
import { doc, collection, query, where, getDocs } from 'firebase/firestore';
import type { P2PAd, Trade, User } from '@/lib/types';
import { Loader2, Info, MessageSquare } from 'lucide-react';
import { TradeDetails } from '@/components/trade/trade-details';
import { TradeChat } from '@/components/trade/trade-chat';
import { CounterpartyInfoPanel } from '@/components/trade/counterparty-info-panel';
import { Button } from '@/components/ui/button';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { usePrices } from '@/context/price-context';
import { useToast } from '@/hooks/use-toast';

function TradePageContent() {
  const params = useParams();
  const { user: authUser, isUserLoading } = useAuth();
  const { firestore } = useFirebase();
  const { isAdmin } = useAdminStatus();
  const { fiatRates } = usePrices();
  const { toast } = useToast();
  const tradeId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [activeView, setActiveView] = useState<'chat' | 'details'>('details');
  const [isInfoPanelOpen, setIsInfoPanelOpen] = useState(false);
  const [completedTradesWithUser, setCompletedTradesWithUser] = useState(0);

  const tradeRef = useMemoFirebase(
    () => (tradeId && firestore ? doc(firestore, 'trades', tradeId as string) : null),
    [tradeId, firestore]
  );
  const { data: trade, isLoading: isTradeLoading } = useDoc<Trade>(tradeRef);

  const opponentId = useMemo(() => {
    if (!trade || !authUser) return null;
    return authUser.uid === trade.buyerId ? trade.sellerId : trade.buyerId;
  }, [trade, authUser]);

  const opponentRef = useMemoFirebase(
    () => (opponentId && firestore ? doc(firestore, 'users', opponentId) : null),
    [opponentId, firestore]
  );
  const { data: opponent, isLoading: isOpponentLoading } = useDoc<User>(opponentRef);
  
  useEffect(() => {
    if (!firestore || !authUser || !opponent) return;

    const fetchTradeCount = async () => {
        const q1 = query(
            collection(firestore, 'trades'),
            where('buyerId', '==', authUser.uid),
            where('sellerId', '==', opponent.id),
            where('status', '==', 'released')
        );
        const q2 = query(
            collection(firestore, 'trades'),
            where('buyerId', '==', opponent.id),
            where('sellerId', '==', authUser.uid),
            where('status', '==', 'released')
        );

        try {
            const [snapshot1, snapshot2] = await Promise.all([getDocs(q1), getDocs(q2)]);
            const total = snapshot1.size + snapshot2.size;
            setCompletedTradesWithUser(total);
        } catch (error) {
            console.error("Failed to fetch trade count with user:", error);
        }
    };

    fetchTradeCount();
  }, [firestore, authUser, opponent]);
  
  useEffect(() => {
    if (trade && trade.status === 'released' && !trade.claimedByBuyer && authUser?.uid === trade.buyerId && firestore) {
        const claim = async () => {
            try {
                let usdAmount = trade.fiatAmountInUSD;
                if (!usdAmount || isNaN(usdAmount)) {
                    const exchangeRate = fiatRates[trade.fiatCurrency] || 1;
                    usdAmount = trade.fiatAmount / exchangeRate;
                }
                await completeEscrow(trade.id, firestore, trade, trade.buyerId, usdAmount);
                toast({ title: 'Funds Claimed', description: `The ${trade.crypto} has been added to your wallet.` });
            } catch (error: any) {
                console.error("Auto-claiming funds failed:", error);
                toast({ variant: 'destructive', title: 'Claim Failed', description: error.message });
            }
        };
        claim();
    }
  }, [trade, authUser, firestore, fiatRates, toast]);


  const currentUserRole = useMemo(() => {
    if(!trade || !authUser) return 'sell';
    return authUser.uid === trade.buyerId ? 'buy' : 'sell';
  }, [trade, authUser])
  
  const adDocRef = useMemoFirebase(() => (trade ? doc(firestore, 'p2p_ads', trade.adId) : null), [trade, firestore]);
  const { data: ad, isLoading: isAdLoading } = useDoc<P2PAd>(adDocRef);


  if (isUserLoading || isTradeLoading || isOpponentLoading || isAdLoading) {
    return (
      <div className="flex flex-1 items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!trade) {
    return (
      <div className="flex flex-1 items-center justify-center h-full">
        <p>Trade not found.</p>
      </div>
    );
  }

  if (!authUser) {
      return (
          <div className="flex flex-1 items-center justify-center h-full">
            <p>Please log in to view this trade.</p>
          </div>
      )
  }

  return (
    <div className="h-full flex flex-col">
      <CounterpartyInfoPanel 
        user={opponent} 
        open={isInfoPanelOpen} 
        onOpenChange={setIsInfoPanelOpen} 
        completedTradesWithUser={completedTradesWithUser}
      />
      
      {/* Desktop Layout */}
      <div className="hidden md:flex gap-0 flex-1 min-h-0">
        <div className="w-[450px] shrink-0 border-r">
          <div className="h-full">
            <TradeDetails trade={trade} ad={ad} currentUserRole={currentUserRole} />
          </div>
        </div>
        <div className="flex-1 relative">
          <div className="absolute inset-0">
            <TradeChat
              currentUserId={authUser.uid}
              trade={trade}
              opponent={opponent}
              isAdmin={isAdmin}
              sellerTerms={ad?.terms}
              onInfoClick={() => setIsInfoPanelOpen(true)}
            />
          </div>
        </div>
      </div>
      
      {/* Mobile Layout */}
       <div className="md:hidden flex flex-col h-full bg-background">
        <div className="flex-1 min-h-0">
          {activeView === 'details' && (
            <div className="h-full overflow-y-auto">
              <TradeDetails trade={trade} ad={ad} currentUserRole={currentUserRole} />
            </div>
          )}
          {activeView === 'chat' && (
            <div className="h-full">
              <TradeChat
                currentUserId={authUser.uid}
                trade={trade}
                opponent={opponent}
                isAdmin={isAdmin}
                sellerTerms={ad?.terms}
                onInfoClick={() => setIsInfoPanelOpen(true)}
              />
            </div>
          )}
        </div>
        <div className="sticky bottom-0 left-0 right-0 z-10 grid grid-cols-2 gap-2 p-2 border-t bg-background shadow-lg">
          <Button variant={activeView === 'details' ? 'secondary' : 'ghost'} onClick={() => setActiveView('details')}>
            <Info className="mr-2 h-4 w-4" />
            Details
          </Button>
          <Button variant={activeView === 'chat' ? 'secondary' : 'ghost'} onClick={() => setActiveView('chat')}>
            <MessageSquare className="mr-2 h-4 w-4" />
            Chat
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function TradePage() {
  return (
    <Suspense fallback={<div className="flex flex-1 items-center justify-center h-full"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>}>
      <TradePageContent />
    </Suspense>
  );
}
