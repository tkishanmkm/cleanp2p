import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function POST(
  req: NextRequest,
  { params }: { params: { tradeId: string } }
) {
  try {
    const { tradeId } = params;
    const { reason } = await req.json().catch(() => ({ reason: 'User requested cancellation' }));

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

    const { data, error } = await supabase.rpc('cancel_p2p_trade', {
      p_trade_id: tradeId,
      p_caller_id: user.id,
      p_reason: reason,
    });

    if (error) {
      console.error('[P2P trade cancel] RPC failed:', error.code || 'UNKNOWN');
      return NextResponse.json({ error: 'Trade cancellation could not be completed.' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
    }

    if (!data || data.success !== true) {
      return NextResponse.json({ error: 'Trade cancellation was not confirmed by the database.' }, { status: 409, headers: { 'Cache-Control': 'no-store' } });
    }

    return NextResponse.json({ success: true, data }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
