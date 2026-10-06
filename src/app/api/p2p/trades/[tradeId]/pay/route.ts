import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';

export async function POST(
  req: NextRequest,
  { params }: { params: { tradeId: string } }
) {
  try {
    const { tradeId } = params;
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

    // Execute atomic mark_p2p_trade_paid RPC on canonical public.trades
    const body = await req.json().catch(() => ({}));
    const paymentMethod = typeof (body.paymentMethod || body.payment_method) === 'string'
      ? (body.paymentMethod || body.payment_method).trim()
      : null;

    const { data, error } = await supabase.rpc('mark_p2p_trade_paid', {
      p_trade_id: tradeId,
      p_caller_id: user.id,
      p_payment_method: paymentMethod,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, data });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
