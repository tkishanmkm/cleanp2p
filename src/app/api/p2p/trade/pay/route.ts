import { NextRequest, NextResponse } from 'next/server';
import { createClient, getSupabaseAdminClient } from '@/utils/supabase/server';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_TRADE_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return NextResponse.json({ success: false, error: 'A valid JSON object is required.' }, { status: 400 });
    }

    const tradeId = typeof body.trade_id === 'string'
      ? body.trade_id.trim()
      : typeof body.tradeId === 'string'
        ? body.tradeId.trim()
        : '';
    if (!UUID_RE.test(tradeId) && !PUBLIC_TRADE_ID_RE.test(tradeId)) {
      return NextResponse.json({ success: false, error: 'A valid trade ID is required.' }, { status: 400 });
    }

    const paymentMethodRaw = body.payment_method ?? body.paymentMethod;
    let paymentMethod: string | null = null;
    if (paymentMethodRaw !== undefined && paymentMethodRaw !== null) {
      if (typeof paymentMethodRaw !== 'string' || paymentMethodRaw.trim().length > 100) {
        return NextResponse.json({ success: false, error: 'Invalid payment method.' }, { status: 400 });
      }
      paymentMethod = paymentMethodRaw.trim() || null;
    }

    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ success: false, error: 'Authentication required.' }, { status: 401 });
    }

    let query = supabase.from('trades').select('id,buyer_id,seller_id,status,escrow_status');
    query = UUID_RE.test(tradeId) ? query.eq('id', tradeId) : query.eq('trade_id', tradeId);
    const { data: trade, error: tradeError } = await query.maybeSingle();
    if (tradeError) {
      console.error('[P2P_TRADE_PAY] Trade lookup failed:', tradeError.code || 'unknown');
      return NextResponse.json({ success: false, error: 'Trade access could not be verified.' }, { status: 503 });
    }
    if (!trade) {
      return NextResponse.json({ success: false, error: 'Trade not found or not accessible.' }, { status: 404 });
    }
    if (trade.buyer_id !== user.id) {
      return NextResponse.json({ success: false, error: 'Only the buyer can mark this trade as paid.' }, { status: 403 });
    }

    // The RPC is service-role-only. The authenticated buyer was verified
    // above; invoke the private settlement function with the trusted server client.
    const adminClient = getSupabaseAdminClient();
    const { data, error } = await adminClient.rpc('mark_p2p_trade_paid', {
      p_trade_id: trade.id,
      p_caller_id: user.id,
      p_payment_method: paymentMethod,
    });
    if (error) {
      console.error('[P2P_TRADE_PAY] Canonical payment RPC failed:', error.code || 'unknown');
      return NextResponse.json({ success: false, error: 'Payment status could not be confirmed.' }, { status: 409 });
    }
    if (!data || typeof data !== 'object' || data.success !== true) {
      return NextResponse.json({ success: false, error: 'Trade payment status was not confirmed.' }, { status: 409 });
    }

    return NextResponse.json(
      { success: true, data, status: data.status || 'payment_sent' },
      { headers: { 'Cache-Control': 'no-store, max-age=0' } }
    );
  } catch {
    return NextResponse.json({ success: false, error: 'Unable to process payment confirmation.' }, { status: 500 });
  }
}
