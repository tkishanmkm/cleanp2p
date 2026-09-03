'use client';

import React, { Suspense, useMemo, useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/components/providers/auth-provider';
import type { P2PAd, Trade, User } from '@/lib/types';
import { Loader2, Info, MessageSquare, ShieldAlert } from 'lucide-react';
import { TradeDetails } from '@/components/trade/trade-details';
import { TradeChat } from '@/components/trade/trade-chat';
import { CounterpartyInfoPanel } from '@/components/trade/counterparty-info-panel';
import { Button } from '@/components/ui/button';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { usePrices } from '@/context/price-context';
import { useToast } from '@/hooks/use-toast';
import { completeEscrow } from '@/lib/wallet';
import { supabase } from '@/lib/supabase/client';

function TradePageContent() {
  const params = useParams();
  const { user: authUser, isUserLoading } = useAuth();
  const { isAdmin } = useAdminStatus();
  const { fiatRates } = usePrices();
  const { toast } = useToast();
  const tradeId = Array.isArray(params.id) ? params.id[0] : params.id;

  const [activeView, setActiveView] = useState<'chat' | 'details'>('details');
  const [isInfoPanelOpen, setIsInfoPanelOpen] = useState(false);
  const [completedTradesWithUser, setCompletedTradesWithUser] = useState(0);

  const [trade, setTrade] = useState<Trade | null>(null);
  const [isTradeLoading, setIsTradeLoading] = useState(true);
  const [accessError, setAccessError] = useState<{ message: string; code?: string } | null>(null);

  const [opponent, setOpponent] = useState<User | null>(null);
  const [isOpponentLoading, setIsOpponentLoading] = useState(false);

  const [ad, setAd] = useState<P2PAd | null>(null);
  const [isAdLoading, setIsAdLoading] = useState(false);

  const mapTradeRecord = (raw: any): Trade => ({
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
  });

  const fetchTrade = useCallback(async () => {
    if (!tradeId) return;
    try {
      // 1. Fetch via backend security guard
      const res = await fetch(`/api/trades/${encodeURIComponent(tradeId)}`);
      const json = await res.json();

      if (!res.ok) {
        setAccessError({ message: json.error || 'Access denied', code: json.code });
        setIsTradeLoading(false);
        return;
      }

      if (json.trade) {
        const mapped = mapTradeRecord(json.trade);
        setTrade(mapped);
        setAccessError(null);
      }
    } catch (err) {
      console.error('Error fetching trade via secure route:', err);
    } finally {
      setIsTradeLoading(false);
    }
  }, [tradeId]);

  useEffect(() => {
    fetchTrade();

    // Listen to live status changes on trades
    const tradeChannel = supabase
      .channel('trade-status-updates')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'trades',
          filter: `id=eq.${tradeId}`,
        },
        (payload: any) => {
          console.log('Trade status changed:', payload.new);
          if (payload.new) {
            setTrade(mapTradeRecord(payload.new));
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(tradeChannel);
    };
  }, [tradeId, fetchTrade]);

  const opponentId = useMemo(() => {
    if (!trade || !authUser) return null;
    return authUser.uid === trade.buyerId ? trade.sellerId : trade.buyerId;
  }, [trade, authUser]);

  useEffect(() => {
    if (!opponentId) return;
    setIsOpponentLoading(true);

    const fetchOpponent = async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', opponentId)
          .single();

        if (!error && data) {
          setOpponent({
            id: data.id,
            userId: data.username || data.id,
            username: data.username,
            email: data.email,
            photoURL: data.photo_url,
            country: data.country,
            preferredCurrency: data.preferred_currency,
            isAdminAccount: data.is_admin_account,
            isSuspended: data.is_suspended,
            createdAt: data.created_at,
            feedbackScore: data.feedback_score,
            completedTrades: data.completed_trades,
          });
        }
      } catch (err) {
        console.error('Error fetching opponent:', err);
      } finally {
        setIsOpponentLoading(false);
      }
    };

    fetchOpponent();
  }, [opponentId]);

  useEffect(() => {
    if (!trade?.adId) return;
    setIsAdLoading(true);

    const fetchAd = async () => {
      try {
        const { data, error } = await supabase
          .from('p2p_ads')
          .select('*')
          .eq('id', trade.adId)
          .single();

        if (!error && data) {
          setAd({
            id: data.id,
            publicAdId: data.public_ad_id,
            userId: data.user_id,
            type: data.type,
            crypto: data.crypto,
            fiatCurrency: data.fiat_currency,
            paymentMethod: data.payment_method,
            pricingType: data.pricing_type,
            margin: data.margin,
            fixedPrice: data.fixed_price,
            minLimit: data.min_limit,
            maxLimit: data.max_limit,
            terms: data.terms,
            offerLabel: data.offer_label,
            tags: data.tags || [],
            paymentTimeLimit: data.payment_time_limit,
            status: data.status,
            createdAt: data.created_at,
          } as P2PAd);
        }
      } catch (err) {
        console.error('Error fetching ad:', err);
      } finally {
        setIsAdLoading(false);
      }
    };

    fetchAd();
  }, [trade?.adId]);

  useEffect(() => {
    if (!authUser?.uid || !opponentId) return;

    const fetchTradeCount = async () => {
      try {
        const { count, error } = await supabase
          .from('trades')
          .select('*', { count: 'exact', head: true })
          .or(
            `and(buyer_id.eq.${authUser.uid},seller_id.eq.${opponentId}),and(buyer_id.eq.${opponentId},seller_id.eq.${authUser.uid})`
          )
          .eq('status', 'released');

        if (!error && count !== null) {
          setCompletedTradesWithUser(count);
        }
      } catch (error) {
        console.error('Failed to fetch trade count with user:', error);
      }
    };

    fetchTradeCount();
  }, [authUser?.uid, opponentId]);

  useEffect(() => {
    if (trade && trade.status === 'released' && !trade.claimedByBuyer && authUser?.uid === trade.buyerId) {
      const claim = async () => {
        try {
          await completeEscrow(trade.id);
          toast({ title: 'Funds Claimed', description: `The ${trade.crypto} has been added to your wallet.` });
        } catch (error: any) {
          console.error('Auto-claiming funds failed:', error);
          toast({ variant: 'destructive', title: 'Claim Failed', description: error.message });
        }
      };
      claim();
    }
  }, [trade, authUser?.uid, toast]);

  const currentUserRole = useMemo(() => {
    if (!trade || !authUser) return 'sell';
    return authUser.uid === trade.buyerId ? 'buy' : 'sell';
  }, [trade, authUser]);

  if (isUserLoading || isTradeLoading || isOpponentLoading || isAdLoading) {
    return (
      <div className="flex flex-1 items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (accessError) {
    return (
      <div className="flex flex-1 items-center justify-center p-6 h-full">
        <div className="max-w-md w-full bg-card border rounded-2xl p-6 text-center space-y-4 shadow-sm">
          <div className="w-12 h-12 rounded-full bg-destructive/10 text-destructive flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Access Restricted</h2>
            <p className="text-sm text-muted-foreground mt-1">{accessError.message}</p>
          </div>
          {accessError.code === 'UNAUTHENTICATED' ? (
            <Button asChild className="w-full">
              <Link href="/login">Sign In</Link>
            </Button>
          ) : (
            <Button asChild variant="outline" className="w-full">
              <Link href="/dashboard">Back to Dashboard</Link>
            </Button>
          )}
        </div>
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
    );
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
    <Suspense
      fallback={
        <div className="flex flex-1 items-center justify-center h-full">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      }
    >
      <TradePageContent />
    </Suspense>
  );
}
