import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> }
) {
  try {
    const { tradeId } = await params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tradeId)) {
      return NextResponse.json({ error: 'A valid trade ID is required.' }, { status: 400 });
    }
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ error: 'A valid JSON object is required.' }, { status: 400 });
    }
    const rawReason = body.reason;
    if (rawReason !== undefined && (typeof rawReason !== 'string' || rawReason.length > 1000)) {
      return NextResponse.json({ error: 'Cancellation reason must be text of at most 1000 characters.' }, { status: 400 });
    }
    const reason = (rawReason || 'User requested cancellation').trim();

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
    if (user.app_metadata?.role === 'admin' || user.user_metadata?.role === 'admin') {
      return NextResponse.json({ error: 'Use the authorized admin workflow for administrative trade actions.' }, { status: 403 });
    }

    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .select('id, buyer_id, seller_id')
      .eq('id', tradeId)
      .maybeSingle();
    if (tradeError) {
      console.error('[p2p/trades/cancel] Unable to verify trade participant access.', { code: tradeError.code });
      return NextResponse.json({ error: 'Unable to verify trade access right now.' }, { status: 503 });
    }
    if (!trade) {
      return NextResponse.json({ error: 'Trade not found or not accessible.' }, { status: 404 });
    }
    if (trade.buyer_id !== user.id && trade.seller_id !== user.id) {
      return NextResponse.json({ error: 'Only trade participants can cancel this trade.' }, { status: 403 });
    }

    const adminClient = getSupabaseAdminClient();
    const { data, error } = await adminClient.rpc('cancel_p2p_trade', {
      p_trade_id: tradeId,
      p_caller_id: user.id,
      p_reason: reason,
    });

    if (error || !data || data.success !== true) {
      console.warn('[p2p/trades/cancel] RPC rejected cancellation', { code: error?.code || null });
      return NextResponse.json({ error: 'Trade cancellation was rejected. Verify the trade status and try again.' }, { status: 400 });
    }

    return NextResponse.json({ success: true, data });
  } catch {
    return NextResponse.json({ error: 'Unable to process trade cancellation right now.' }, { status: 500 });
  }
}
