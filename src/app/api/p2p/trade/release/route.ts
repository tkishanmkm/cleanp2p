import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // 1. Authenticate Requesting User (Seller)
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
    const tradeId = body.tradeId || body.trade_id;

    if (!tradeId) {
      return NextResponse.json(
        { success: false, error: 'Valid tradeId is required' },
        { status: 400 }
      );
    }

    // 3. Execute Atomic RPC Procedure (Releases Escrow to Buyer & Completes Trade)
    const { data, error } = await supabase.rpc('complete_p2p_trade', {
      p_trade_id: tradeId,
      p_seller_id: user.id,
    });

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    // 4. Return Success Response
    return NextResponse.json({
      success: true,
      tradeId: data?.trade_id || tradeId,
      message: 'Escrow released successfully and buyer wallet credited.',
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
