import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function POST(req: NextRequest) {
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
        },
      }
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { adId, cryptoAmount, fiatAmount } = await req.json();

    if (!adId || !cryptoAmount || !fiatAmount || Number(cryptoAmount) <= 0) {
      return NextResponse.json({ error: 'Invalid order parameters' }, { status: 400 });
    }

    // Call atomic initiate_p2p_trade RPC
    const { data, error } = await supabase.rpc('initiate_p2p_trade', {
      p_ad_id: adId,
      p_buyer_id: user.id,
      p_crypto_amount: Number(cryptoAmount),
      p_fiat_amount: Number(fiatAmount),
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const tradeId = typeof data === 'string' ? data : (data?.trade_id || data?.id || data);
    return NextResponse.json({ success: true, tradeId, data }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
