import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';
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
    // Administrator settlement belongs to the dedicated admin workflow. This route
    // must never let admin metadata widen participant cancellation privileges.
    if (user.app_metadata?.role === 'admin' || user.user_metadata?.role === 'admin') {
      return NextResponse.json({ success: false, error: 'Use the authorized admin workflow for administrative trade actions.' }, { status: 403 });
    }

    // 2. Parse and validate payload before invoking the canonical RPC.
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON request body.' },
        { status: 400 }
      );
    }

    const tradeId = typeof (body.tradeId || body.trade_id) === 'string'
      ? String(body.tradeId || body.trade_id).trim()
      : '';
    const reason = typeof body.reason === 'string' ? body.reason.trim() : 'User requested cancellation';
    if (reason.length < 3 || reason.length > 500) {
      return NextResponse.json(
        { success: false, error: 'Cancellation reason must be between 3 and 500 characters.' },
        { status: 400 }
      );
    }
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const publicTradeIdPattern = /^[A-Za-z0-9_-]{6,64}$/;
    if (!uuidPattern.test(tradeId) && !publicTradeIdPattern.test(tradeId)) {
      return NextResponse.json(
        { success: false, error: 'A valid trade ID is required.' },
        { status: 400 }
      );
    }

    // This user-facing endpoint is participant-only. Resolve public trade IDs
    // through the authenticated RLS client, then pass the canonical UUID to RPC.
    let tradeQuery = supabase.from('trades').select('id, buyer_id, seller_id');
    tradeQuery = uuidPattern.test(tradeId)
      ? tradeQuery.eq('id', tradeId)
      : tradeQuery.eq('trade_id', tradeId);
    const { data: trade, error: tradeError } = await tradeQuery.maybeSingle();

    if (tradeError) {
      console.error('[p2p/trade/cancel] Unable to verify trade participant access.', { code: tradeError.code });
      return NextResponse.json({ success: false, error: 'Unable to verify trade access right now.' }, { status: 503 });
    }
    if (!trade) {
      return NextResponse.json({ success: false, error: 'Trade not found or not accessible.' }, { status: 404 });
    }
    if (trade.buyer_id !== user.id && trade.seller_id !== user.id) {
      return NextResponse.json({ success: false, error: 'Only trade participants can cancel this trade.' }, { status: 403 });
    }

    // Use the service-role RPC only after this route has verified the caller is a participant.
    // The RPC remains authoritative for atomic accounting and state transitions.
    const adminClient = getSupabaseAdminClient();
    const { data, error } = await adminClient.rpc('cancel_p2p_trade', {
      p_trade_id: trade.id,
      p_caller_id: user.id,
      p_reason: reason,
    });

    if (error || !data || typeof data !== 'object' || data.success !== true) {
      console.warn('[p2p/trade/cancel] Canonical cancellation RPC rejected the request.');
      return NextResponse.json(
        { success: false, error: 'Trade cancellation was rejected. Check the trade status and your permissions.' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, result: data });
  } catch {
    console.error('[p2p/trade/cancel] Unexpected cancellation failure.');
    return NextResponse.json(
      { success: false, error: 'Unable to cancel trade right now. Please try again.' },
      { status: 500 }
    );
  }
}
