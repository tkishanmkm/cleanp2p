import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const supabase = await createClient();

    // Authenticate the caller before accepting any trade identifier.
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

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, error: 'A valid JSON request body is required' },
        { status: 400 }
      );
    }

    const rawTradeId = body.tradeId ?? body.trade_id;
    if (typeof rawTradeId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(rawTradeId)) {
      return NextResponse.json(
        { success: false, error: 'Valid tradeId is required' },
        { status: 400 }
      );
    }

    // Keep the reason server-controlled. The RPC signature requires p_reason;
    // never let client text alter the financial audit reason.
    const { data, error } = await supabase.rpc('cancel_p2p_trade', {
      p_trade_id: rawTradeId,
      p_caller_id: user.id,
      p_reason: 'user_cancelled',
    });

    if (error) {
      // Avoid returning database internals to the client.
      return NextResponse.json(
        { success: false, error: 'Trade cancellation failed' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, result: data });
  } catch {
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}
