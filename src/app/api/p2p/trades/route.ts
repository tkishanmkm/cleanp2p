import { createClient } from '@/utils/supabase/server';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const supabase = await createClient();

    // 1. Authenticate user
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // 2. Fetch trades where user is buyer or seller
    const { data: trades, error } = await supabase
      .from('p2p_trades')
      .select('*')
      .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
      .order('created_at', { ascending: false });

    if (error) {
      // Fallback: If table name is p2p_orders acting as trades
      const { data: orders, error: orderErr } = await supabase
        .from('p2p_orders')
        .select('*')
        .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
        .order('created_at', { ascending: false });

      if (orderErr) {
        return NextResponse.json({ success: true, trades: [] });
      }

      const formatted = (orders || []).map((o: any) => ({
        id: o.id,
        order_id: o.ad_id || o.id,
        seller_id: o.seller_id,
        buyer_id: o.buyer_id,
        amount: o.crypto_amount || o.total_amount || 0,
        fiat_amount: o.fiat_amount || (Number(o.price_per_unit || 0) * Number(o.total_amount || 0)),
        status: o.status === 'PENDING' ? 'PENDING_PAYMENT' : o.status,
        created_at: o.created_at || new Date().toISOString(),
      }));

      return NextResponse.json({ success: true, trades: formatted });
    }

    return NextResponse.json({ success: true, trades: trades || [] });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
