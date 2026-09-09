'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { supabase } from '@/lib/supabase/client';
import OnboardingGuard from '@/components/OnboardingGuard';
import TradeRoom from '@/components/TradeRoom';

export default function TradePage() {
  const params = useParams();
  const tradeIdParam = (params?.id || params?.tradeId) as string;

  const [trade, setTrade] = useState<any>(null);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadTradeData() {
      // 1. Get authenticated user
      const { data: { user }, error: authErr } = await supabase.auth.getUser();
      if (authErr || !user) {
        setError('Please sign in to view this trade room.');
        setLoading(false);
        return;
      }
      setCurrentUser(user);

      // 2. Fetch trade details
      const { data: tradeData, error: tradeErr } = await supabase
        .from('trades')
        .select('*')
        .or(`trade_id.eq.${tradeIdParam},ad_id.eq.${tradeIdParam}`)
        .single();

      if (tradeErr || !tradeData) {
        // Safe fallback for id column or short id format
        const { data: fallbackTrade } = await supabase
          .from('trades')
          .select('*')
          .eq('id', tradeIdParam)
          .maybeSingle();

        if (fallbackTrade) {
          setTrade(fallbackTrade);
        } else {
          setError('Trade record not found or access denied.');
        }
      } else {
        setTrade(tradeData);
      }
      setLoading(false);
    }

    if (tradeIdParam) {
      loadTradeData();
    }
  }, [tradeIdParam, supabase]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-400">
        Loading secure trade session...
      </div>
    );
  }

  if (error || !trade) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-rose-400">
        {error || 'Unable to load trade.'}
      </div>
    );
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 py-10">
      <OnboardingGuard>
        <div className="max-w-6xl mx-auto px-4 mb-6">
          <div className="flex items-center justify-between border-b border-slate-800 pb-4">
            <div>
              <h1 className="text-2xl font-bold">P2P Trade Execution</h1>
              <p className="text-sm text-slate-400">
                Trade ID: <span className="font-mono text-slate-200">{trade.trade_id || trade.id}</span>
              </p>
            </div>
            <div className="text-right">
              <span className="text-xs uppercase text-slate-400 block">Escrow Amount</span>
              <span className="text-lg font-bold text-emerald-400">
                {trade.crypto_amount || trade.amount} {trade.asset_symbol || trade.crypto || 'BTC'} ({trade.fiat_amount || trade.amount_usd} {trade.fiat_currency || trade.fiat_symbol || 'USD'})
              </span>
            </div>
          </div>
        </div>

        {/* Real-time trade room with chat & escrow triggers */}
        <TradeRoom
          tradeId={trade.trade_id || trade.id}
          currentUserId={currentUser.id}
          sellerId={trade.seller_id}
          buyerId={trade.buyer_id}
          initialStatus={trade.status}
        />
      </OnboardingGuard>
    </main>
  );
}
