import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // 1. Authenticate Requesting User (Buyer)
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized request' },
        { status: 401 }
      );
    }

    // 2. Parse Payload
    const body = await request.json();
    const orderId = body.orderId || body.order_id || body.adId || body.ad_id;
    const amount = body.amount ?? body.cryptoAmount;

    if (!orderId || !amount || Number(amount) <= 0) {
      return NextResponse.json(
        { success: false, error: 'Valid orderId and positive amount are required' },
        { status: 400 }
      );
    }

    // 3. Execute Atomic RPC Procedure (Locks Escrow & Creates Trade)
    const { data, error } = await supabase.rpc('initiate_p2p_trade', {
      p_order_id: orderId,
      p_buyer_id: user.id,
      p_amount: Number(amount),
    });

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    // 4. Return Created Trade Details
    return NextResponse.json({
      success: true,
      tradeId: data?.trade_id ?? data?.id ?? data,
      fiatAmount: data?.fiat_amount ?? null,
      data,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
