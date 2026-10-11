import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // 1. Authenticate Requesting User
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

    // 3. Execute Cancel RPC
    const { data, error } = await supabase.rpc('cancel_p2p_trade', {
      p_trade_id: tradeId,
      p_caller_id: user.id,
    });

    if (error) {
      console.error('[P2P trade cancel] cancel_p2p_trade RPC failed:', error.code || 'UNKNOWN');
      return NextResponse.json(
        { success: false, error: 'Trade cancellation could not be completed.' },
        { status: 400, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    if (!data || data.success !== true) {
      return NextResponse.json(
        { success: false, error: 'Trade cancellation was not confirmed by the database.' },
        { status: 409, headers: { 'Cache-Control': 'no-store' } }
      );
    }

    return NextResponse.json({ success: true, result: data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
