import { NextResponse } from 'next/server';
import { createClient } from '@/utils/supabase/server';

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { adId, buyerId, sellerId, cryptoAmount, cryptoSymbol, rate, fiatCurrency, paymentMethod } = body;

    if (!adId || !buyerId || !sellerId || !cryptoSymbol) {
      return NextResponse.json({ error: 'Missing required trade parameters' }, { status: 400 });
    }

    // Call atomic initiate_p2p_trade RPC
    const { data, error } = await supabase.rpc('initiate_p2p_trade', {
      p_ad_id: adId,
      p_buyer_id: buyerId,
      p_seller_id: sellerId,
      p_crypto_amount: Number(cryptoAmount || 0),
      p_crypto_symbol: cryptoSymbol,
      p_rate: Number(rate || 0),
      p_fiat_amount: Number(cryptoAmount || 0) * Number(rate || 1),
      p_fiat_currency: fiatCurrency || 'INR',
      p_payment_method: paymentMethod || 'Bank Transfer'
    });

    if (error) {
      console.error('RPC initiate_p2p_trade error:', error);
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, trade: data });
  } catch (err: any) {
    console.error('Trade creation API error:', err);
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 });
  }
}
