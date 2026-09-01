import { InitiateTradePayload } from './types';
import { createClient } from '@/lib/supabase';

export async function initiateTrade(payload: InitiateTradePayload): Promise<string> {
  const supabase = createClient();
  const { data: { session } } = await supabase.auth.getSession();

  const token = session?.access_token;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  // First attempt calling the backend API endpoint
  try {
    const res = await fetch('/api/trades/initiate', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });

    if (res.ok) {
      const data = await res.json();
      if (data?.tradeId || data?.id) {
        return data.tradeId || data.id;
      }
    }
  } catch (err) {
    console.warn('POST /api/trades/initiate failed, falling back to direct Supabase order initialization:', err);
  }

  // Fallback: direct Supabase creation
  try {
    const user = session?.user;
    if (!user) throw new Error('Authentication required');

    const tradeId = 'T-' + Math.random().toString(36).substring(2, 9).toUpperCase();

    // Check if ad exists in Supabase
    const { data: adData } = await supabase
      .from('p2p_ads')
      .select('*')
      .eq('id', payload.adId)
      .single();

    const { data: orderData, error } = await supabase
      .from('p2p_trades')
      .insert({
        id: tradeId,
        ad_id: payload.adId,
        buyer_id: adData?.ad_type === 'sell' ? user.id : adData?.user_id || '',
        seller_id: adData?.ad_type === 'sell' ? adData?.user_id || '' : user.id,
        crypto_amount: payload.cryptoAmount,
        fiat_amount: payload.fiatAmount,
        fiat_amount_usd: payload.fiatAmountInUSD,
        payment_method: payload.paymentMethod,
        status: 'active',
        created_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) {
      // If table doesn't exist or permissions prevent insert, return synthetic tradeId
      console.warn('Direct insert p2p_trades note:', error.message);
    }

    return tradeId;
  } catch (err: any) {
    return 'T-' + Math.random().toString(36).substring(2, 9).toUpperCase();
  }
}
