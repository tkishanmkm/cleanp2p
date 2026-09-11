'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { TradeDetails, formatTradeId } from '@/components/trade/trade-details';
import { TradeChat } from '@/components/trade/trade-chat';
import { CounterpartyInfoPanel } from '@/components/trade/counterparty-info-panel';
import OnboardingGuard from '@/components/OnboardingGuard';
import { useAdminStatus } from '@/hooks/use-admin-status';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { FileText, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function TradePage() {
  const params = useParams();
  const tradeIdParam = (params?.id || params?.tradeId) as string;
  const supabase = createClient();
  const { isAdmin } = useAdminStatus();

  const [trade, setTrade] = useState<any>(null);
  const [ad, setAd] = useState<any>(null);
  const [opponent, setOpponent] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCounterpartyOpen, setIsCounterpartyOpen] = useState(false);
  const [completedTradesWithUser, setCompletedTradesWithUser] = useState(0);

  // Mobile active view toggle ('details' | 'chat')
  const [mobileActiveTab, setMobileActiveTab] = useState<'details' | 'chat'>('details');

  const loadTradeData = useCallback(async () => {
    if (!tradeIdParam) return;

    try {
      // 1. Get authenticated user
      const {
        data: { user },
        error: authErr
      } = await supabase.auth.getUser();

      if (authErr || !user) {
        setError('Please sign in to view this trade room.');
        setLoading(false);
        return;
      }
      setCurrentUser(user);

      // 2. Fetch trade details
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeIdParam);
      let tradeQuery = supabase.from('trades').select('*');
      if (isUuid) {
        tradeQuery = tradeQuery.or(`id.eq.${tradeIdParam},trade_id.eq.${tradeIdParam},public_id.eq.${tradeIdParam}`);
      } else {
        tradeQuery = tradeQuery.or(`trade_id.eq.${tradeIdParam},public_id.eq.${tradeIdParam}`);
      }
      let { data: tradeData, error: tradeErr } = await tradeQuery.maybeSingle();

      if (!tradeData && tradeErr) {
        setError('Trade record not found or access denied.');
        setLoading(false);
        return;
      }

      if (!tradeData) {
        setError('Trade record not found.');
        setLoading(false);
        return;
      }

      setTrade(tradeData);

      // 3. Determine counterparty & role
      const isBuyer = user.id === (tradeData.buyer_id || tradeData.buyerId);
      const opponentId = isBuyer ? (tradeData.seller_id || tradeData.sellerId) : (tradeData.buyer_id || tradeData.buyerId);

      // 4. Fetch Counterparty Profile
      if (opponentId) {
        const { data: opponentProfile } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', opponentId)
          .maybeSingle();

        if (opponentProfile) {
          setOpponent({
            id: opponentProfile.id,
            userId: opponentProfile.username || opponentProfile.id?.substring(0, 8),
            username: opponentProfile.username,
            fullName: opponentProfile.full_name,
            dob: opponentProfile.dob,
            country: opponentProfile.country,
            ipBasedCountry: opponentProfile.ip_based_country,
            photoURL: opponentProfile.photo_url,
            feedbackScore: opponentProfile.feedback_score,
            positiveFeedback: opponentProfile.positive_feedback,
            negativeFeedback: opponentProfile.negative_feedback,
            completedTrades: opponentProfile.completed_trades,
            blockedUsers: opponentProfile.blocked_users,
            createdAt: opponentProfile.created_at,
            lastActive: opponentProfile.last_active
          });
        } else {
          setOpponent({
            id: opponentId,
            userId: isBuyer ? 'Seller' : 'Buyer',
            username: isBuyer ? 'Seller' : 'Buyer'
          });
        }

        // Fetch completed trades count between these two users
        const { count } = await supabase
          .from('trades')
          .select('*', { count: 'exact', head: true })
          .eq('status', 'released')
          .or(`and(buyer_id.eq.${user.id},seller_id.eq.${opponentId}),and(buyer_id.eq.${opponentId},seller_id.eq.${user.id})`);

        if (count !== null) {
          setCompletedTradesWithUser(count);
        }
      }

      // 5. Fetch Ad details if ad_id is present
      const adId = tradeData.ad_id || tradeData.adId;
      if (adId) {
        const { data: adData } = await supabase
          .from('ads')
          .select('*')
          .eq('id', adId)
          .maybeSingle();

        if (adData) {
          setAd(adData);
        }
      }
    } catch (err: any) {
      console.error('Error loading trade:', err);
      setError(err.message || 'Failed to load trade room.');
    } finally {
      setLoading(false);
    }
  }, [tradeIdParam, supabase]);

  useEffect(() => {
    loadTradeData();

    // Subscribe to trade updates
    const pageTopic = `trade-page-${tradeIdParam}-${Math.random().toString(36).substring(2, 9)}`;
    const tradeChannel = supabase
      .channel(pageTopic)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'trades', filter: `id=eq.${tradeIdParam}` },
        (payload) => {
          setTrade((prev: any) => ({ ...prev, ...payload.new }));
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(tradeChannel);
    };
  }, [tradeIdParam, loadTradeData, supabase]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center p-4">
        <div className="w-full max-w-5xl space-y-4">
          <Skeleton className="h-16 w-full" />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Skeleton className="h-[550px] w-full" />
            <Skeleton className="h-[550px] w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !trade) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-destructive p-4">
        <p className="text-base font-semibold mb-2">{error || 'Unable to load trade.'}</p>
      </div>
    );
  }

  const isBuyer = currentUser?.id === (trade.buyer_id || trade.buyerId);
  const currentUserRole: 'buy' | 'sell' = isBuyer ? 'buy' : 'sell';
  const sellerTerms = ad?.terms || trade.terms || trade.seller_terms;

  return (
    <OnboardingGuard>
      <div className="flex-1 min-h-0 flex flex-col h-full overflow-hidden bg-background text-foreground">
        {/* Desktop View: Dual-pane side-by-side filling height with independent scrolling */}
        <div className="hidden lg:flex flex-1 min-h-0 p-4 max-w-7xl mx-auto w-full">
          <div className="w-full h-full grid grid-cols-12 border border-border/80 rounded-2xl overflow-hidden bg-card shadow-sm min-h-0">
            {/* Left Column: Trade Details */}
            <div className="lg:col-span-5 border-r border-border/80 flex flex-col h-full min-h-0 overflow-hidden">
              <TradeDetails
                trade={trade}
                ad={ad}
                currentUserRole={currentUserRole}
              />
            </div>

            {/* Right Column: Encrypted Escrow Chat */}
            <div className="lg:col-span-7 flex flex-col h-full min-h-0 overflow-hidden">
              <TradeChat
                currentUserId={currentUser.id}
                trade={trade}
                opponent={opponent}
                isAdmin={isAdmin}
                sellerTerms={sellerTerms}
                onInfoClick={() => setIsCounterpartyOpen(true)}
              />
            </div>
          </div>
        </div>

        {/* Mobile View: Scrollable middle content between top navigation header and bottom footer */}
        <div className="lg:hidden flex-1 min-h-0 flex flex-col overflow-hidden relative">
          <div className="flex-1 min-h-0 h-full overflow-hidden flex flex-col bg-card">
            {mobileActiveTab === 'details' ? (
              <div className="h-full flex flex-col min-h-0 overflow-hidden">
                <TradeDetails
                  trade={trade}
                  ad={ad}
                  currentUserRole={currentUserRole}
                />
              </div>
            ) : (
              <div className="h-full flex flex-col min-h-0 overflow-hidden">
                <TradeChat
                  currentUserId={currentUser.id}
                  trade={trade}
                  opponent={opponent}
                  isAdmin={isAdmin}
                  sellerTerms={sellerTerms}
                  onInfoClick={() => setIsCounterpartyOpen(true)}
                />
              </div>
            )}
          </div>

          {/* Mobile Bottom Footer: Fixed Tabs for Trade Details and Trade Chat */}
          <footer className="shrink-0 border-t border-border bg-card/95 backdrop-blur-md px-3 py-2 shadow-lg z-30">
            <nav aria-label="Trade mobile navigation" className="flex items-center gap-2 max-w-md mx-auto">
              <Button
                id="trade-tab-details-btn"
                variant={mobileActiveTab === 'details' ? 'default' : 'ghost'}
                size="default"
                onClick={() => setMobileActiveTab('details')}
                className={cn(
                  'flex-1 h-11 text-xs sm:text-sm font-bold gap-2 rounded-xl transition-all shadow-xs',
                  mobileActiveTab === 'details'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/80'
                )}
              >
                <FileText className="h-4 w-4 shrink-0" />
                <span>Trade Details</span>
              </Button>
              <Button
                id="trade-tab-chat-btn"
                variant={mobileActiveTab === 'chat' ? 'default' : 'ghost'}
                size="default"
                onClick={() => setMobileActiveTab('chat')}
                className={cn(
                  'flex-1 h-11 text-xs sm:text-sm font-bold gap-2 rounded-xl transition-all shadow-xs',
                  mobileActiveTab === 'chat'
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/80'
                )}
              >
                <MessageSquare className="h-4 w-4 shrink-0" />
                <span>Trade Chat</span>
              </Button>
            </nav>
          </footer>
        </div>

        {/* Counterparty Inspection Drawer */}
        <CounterpartyInfoPanel
          user={opponent}
          open={isCounterpartyOpen}
          onOpenChange={setIsCounterpartyOpen}
          completedTradesWithUser={completedTradesWithUser}
          activeTradeId={trade?.id}
        />
      </div>
    </OnboardingGuard>
  );
}
