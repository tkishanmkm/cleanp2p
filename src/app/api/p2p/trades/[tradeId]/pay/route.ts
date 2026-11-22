import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getSupabaseAdminClient } from '@/lib/supabase/server';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ tradeId: string }> }
) {
  try {
    const { tradeId } = await params;
    if (typeof tradeId !== 'string' || !UUID_RE.test(tradeId)) {
      return NextResponse.json({ error: 'Invalid trade ID' }, { status: 400 });
    }

    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return req.cookies.getAll();
          },
          setAll() {
            // This route only performs an authenticated RPC; middleware handles
            // session refresh and cookie persistence for the application.
          },
        },
      }
    );

    const { data: authData, error: authError } = await supabase.auth.getUser();
    const user = authData?.user;
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Payment confirmation is a buyer action. Do not rely on an admin exception
    // in the SECURITY DEFINER RPC; its authenticated caller path is participant-only.
    const { data: trade, error: tradeError } = await supabase
      .from('trades')
      .select('buyer_id')
      .eq('id', tradeId)
      .maybeSingle();
    if (tradeError) {
      console.error('[p2p/trades/pay] Unable to verify trade buyer.', { code: tradeError.code || null });
      return NextResponse.json({ error: 'Unable to verify trade access right now.' }, { status: 503 });
    }
    if (!trade) {
      return NextResponse.json({ error: 'Trade not found.' }, { status: 404 });
    }
    if (trade.buyer_id !== user.id) {
      return NextResponse.json({ error: 'Only the buyer can mark this trade as paid.' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const rawPaymentMethod = body?.paymentMethod ?? body?.payment_method;
    let paymentMethod: string | null = null;
    if (rawPaymentMethod !== undefined && rawPaymentMethod !== null) {
      if (typeof rawPaymentMethod !== 'string') {
        return NextResponse.json({ error: 'Invalid payment method' }, { status: 400 });
      }
      paymentMethod = rawPaymentMethod.trim();
      if (paymentMethod.length > 100) {
        return NextResponse.json({ error: 'Payment method is too long' }, { status: 400 });
      }
      if (!paymentMethod) paymentMethod = null;
    }

    // mark_p2p_trade_paid is service-role-only; the buyer identity and
    // participant relationship were verified with the cookie-bound client above.
    const adminClient = getSupabaseAdminClient();
    const { data, error } = await adminClient.rpc('mark_p2p_trade_paid', {
      p_trade_id: tradeId,
      p_caller_id: user.id,
      p_payment_method: paymentMethod,
    });

    if (error) {
      // Keep database details in server logs only; do not expose them to clients.
      console.error('[p2p/trades/pay] mark_p2p_trade_paid failed', {
        code: error.code ?? 'unknown',
      });
      return NextResponse.json({ error: 'Unable to mark trade as paid' }, { status: 400 });
    }

    if (!data || typeof data !== 'object' || data.success !== true) {
      return NextResponse.json({ error: 'Trade payment status was not confirmed' }, { status: 409 });
    }

    return NextResponse.json({ success: true, data });
  } catch {
    return NextResponse.json({ error: 'Unable to process payment confirmation' }, { status: 500 });
  }
}
