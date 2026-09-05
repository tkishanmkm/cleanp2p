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

    // Fetch existing trade to validate status and permissions
    const { data: trade, error: fetchError } = await supabase
      .from('p2p_trades')
      .select('*')
      .eq('id', tradeId)
      .single();

    if (fetchError || !trade) {
      return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
    }

    if (trade.buyer_id !== user.id) {
      return NextResponse.json({ error: 'Only the buyer can mark a trade as paid' }, { status: 403 });
    }

    if (trade.status !== 'PENDING_PAYMENT') {
      return NextResponse.json(
        { error: `Cannot transition from state '${trade.status}' to 'PAID'` },
        { status: 400 }
      );
    }

    // Transition state to PAID
    const { data: updatedTrade, error: updateError } = await supabase
      .from('p2p_trades')
      .update({
        status: 'PAID',
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', tradeId)
      .select()
      .single();

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 400 });
    }

    return NextResponse.json({ success: true, trade: updatedTrade });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
